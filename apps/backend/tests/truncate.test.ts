import { describe, it, expect } from "vitest";
import {
  SCHEMA_VERSION,
  type ExtractedContent,
  type MainContentItem,
  type DiscussionItem,
} from "@signaltap/schemas";
import { truncateExtracted, DEFAULT_TRUNCATE_LIMITS } from "@signaltap/analysis";
import { runAnalysis } from "../src/analysis";

function makeContent(opts: {
  blocks?: number;
  blockLen?: number;
  comments?: number;
  limits?: { maxChars?: number; maxBlocks?: number; maxComments?: number };
}): { extracted: ExtractedContent; result: ReturnType<typeof truncateExtracted> } {
  const blocks: MainContentItem[] = [];
  for (let i = 0; i < (opts.blocks ?? 10); i++) {
    blocks.push({
      id: `paragraph-${i}`,
      text: "word ".repeat(opts.blockLen ?? 50),
      headingPath: i % 3 === 0 ? [`Section ${i}`] : undefined,
      position: i,
    });
  }
  const comments: DiscussionItem[] = [];
  for (let i = 0; i < (opts.comments ?? 0); i++) {
    comments.push({
      id: `comment-${i}`,
      parentId: null,
      author: `u/user${i}`,
      text: `comment body number ${i}`,
      score: i, // ascending: highest score is the last one
      depth: 0,
      permalink: null,
      position: i,
    });
  }
  const extracted: ExtractedContent = {
    schemaVersion: SCHEMA_VERSION,
    adapter: "GenericArticleAdapter",
    adapterVersion: "1.0.0",
    pageType: "article",
    url: "https://example.com/long-article",
    mainContent: blocks,
    discussionItems: comments,
    captureScope: "full_page",
    extractionWarnings: [],
  };
  const result = truncateExtracted(extracted, opts.limits);
  return { extracted, result };
}

describe("truncateExtracted — main content", () => {
  it("does not truncate when within limits", () => {
    const { result } = makeContent({ blocks: 5, blockLen: 10 });
    expect(result.truncated).toBe(false);
    expect(result.removedBlocks).toBe(0);
    expect(result.removedChars).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("caps by block count, keeping document order", () => {
    const { result } = makeContent({
      blocks: 300,
      blockLen: 10,
      limits: { maxBlocks: 120, maxChars: 1_000_000, maxComments: 1000 },
    });
    expect(result.truncated).toBe(true);
    expect(result.extracted.mainContent).toHaveLength(120);
    expect(result.extracted.mainContent[0].id).toBe("paragraph-0");
    expect(result.extracted.mainContent[119].id).toBe("paragraph-119");
    expect(result.removedBlocks).toBe(180);
    expect(
      result.warnings.some((w) => w.code === "content_truncated")
    ).toBe(true);
  });

  it("caps by character budget, dropping the tail and reporting removed chars", () => {
    // 50 blocks * 100 words * ~6 chars = ~30k chars, well over the 2k budget.
    const { result } = makeContent({
      blocks: 50,
      blockLen: 100,
      limits: { maxBlocks: 1000, maxChars: 2000, maxComments: 1000 },
    });
    expect(result.truncated).toBe(true);
    const total = result.extracted.mainContent
      .map((b) => b.text.length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(2000);
    expect(result.removedChars).toBeGreaterThan(0);
    // kept blocks preserve order and original source IDs
    expect(result.extracted.mainContent[0].id).toBe("paragraph-0");
  });

  it("does not mutate the input content object", () => {
    const { extracted, result } = makeContent({
      blocks: 300,
      limits: { maxBlocks: 50, maxChars: 1_000_000, maxComments: 1000 },
    });
    expect(extracted.mainContent).toHaveLength(300);
    expect(result.extracted.mainContent).toHaveLength(50);
  });
});

describe("truncateExtracted — discussion items", () => {
  it("keeps the top-scored comments, then restores document order", () => {
    const { result } = makeContent({
      blocks: 2,
      comments: 200,
      limits: { maxBlocks: 1000, maxChars: 1_000_000, maxComments: 60 },
    });
    expect(result.truncated).toBe(true);
    expect(result.extracted.discussionItems).toHaveLength(60);
    expect(result.removedComments).toBe(140);
    // The 60 highest-scored (score 140..199) are kept...
    const scores = result.extracted.discussionItems.map((c) => c.score);
    expect(Math.min(...scores)).toBe(140);
    expect(Math.max(...scores)).toBe(199);
    // ...and within the result they are sorted by document position.
    const positions = result.extracted.discussionItems.map((c) => c.position);
    const sortedAsc = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sortedAsc);
    expect(positions[0]).toBe(140);
    expect(
      result.warnings.some((w) => w.code === "comments_truncated")
    ).toBe(true);
  });

  it("does not truncate comments when under the cap", () => {
    const { result } = makeContent({ blocks: 2, comments: 10 });
    expect(result.extracted.discussionItems).toHaveLength(10);
    expect(
      result.warnings.some((w) => w.code === "comments_truncated")
    ).toBe(false);
  });
});

describe("runAnalysis applies the long-content strategy", () => {
  it("analyzes a bounded subset when the page is huge", async () => {
    const { extracted } = makeContent({
      blocks: 500,
      blockLen: 80,
      comments: 300,
      limits: DEFAULT_TRUNCATE_LIMITS,
    });
    const res = await runAnalysis({
      schemaVersion: SCHEMA_VERSION,
      url: extracted.url,
      profile: "general",
      extracted,
    });
    // The mock provider reports stats from the content it actually analyzed.
    expect(res.stats.mainContentCount).toBeLessThanOrEqual(
      DEFAULT_TRUNCATE_LIMITS.maxBlocks
    );
    expect(res.stats.discussionCount).toBeLessThanOrEqual(
      DEFAULT_TRUNCATE_LIMITS.maxComments
    );
  });
});
