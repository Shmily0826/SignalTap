import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { HackerNewsAdapter } from "../../src/adapters/hackernews";
import { GitHubIssueAdapter } from "../../src/adapters/githubIssue";
import { YouTubeAdapter } from "../../src/adapters/youtube";
import { assertExtractedContent } from "@signaltap/schemas";

const fixtures = (name: string) =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

const HN_URL = "https://news.ycombinator.com/item?id=12345";
const GH_URL = "https://github.com/owner/repo/issues/42";
const YT_URL = "https://www.youtube.com/watch?v=abc123";

describe("HackerNews extraction", () => {
  const dom = new JSDOM(fixtures("hackernews.html"), { url: HN_URL });
  const extracted = HackerNewsAdapter.extract(dom.window.document, HN_URL);

  it("returns valid schema with pageType discussion", () => {
    expect(() => assertExtractedContent(extracted)).not.toThrow();
    expect(extracted.pageType).toBe("discussion");
    expect(extracted.adapter).toBe("HackerNewsAdapter");
  });

  it("captures the story title and story text", () => {
    expect(extracted.title).toContain("Local-first note app");
    // story text becomes comment-1 (the root item)
    const root = extracted.discussionItems[0];
    expect(root.text).toContain("CRDT-based note app");
    expect(root.permalink).toBe(HN_URL);
  });

  it("extracts comments with authors, permalinks and indent-based depth", () => {
    const items = extracted.discussionItems;
    expect(items.length).toBe(5); // story text + 4 comments
    const alice = items.find((d) => d.author === "alice_dev")!;
    expect(alice.depth).toBe(0);
    expect(alice.text).toContain("Conflict resolution is solid");
    const bob = items.find((d) => d.author === "bob_crdt")!;
    expect(bob.depth).toBe(1); // indent width 40
    const carol = items.find((d) => d.author === "carol")!;
    expect(carol.depth).toBe(2); // indent width 80
    expect(alice.permalink).toContain("item?id=1");
  });

  it("marks deleted comments and keeps a subset warning", () => {
    const del = extracted.discussionItems.find((d) => d.deleted);
    expect(del?.text).toBe("[deleted]");
    expect(extracted.captureScope).toBe("loaded_content");
    expect(
      extracted.extractionWarnings.some((w) => w.code === "comments_loaded_subset")
    ).toBe(true);
  });

  it("annotates DOM elements with stable source IDs without altering text", () => {
    const first = extracted.discussionItems[0];
    const el = dom.window.document.querySelector(`[data-sigsoil-id="${first.id}"]`);
    expect(el).not.toBeNull();
  });
});

describe("GitHub issue extraction", () => {
  const dom = new JSDOM(fixtures("github-issue.html"), { url: GH_URL });
  const extracted = GitHubIssueAdapter.extract(dom.window.document, GH_URL);

  it("returns valid schema with the issue title", () => {
    expect(() => assertExtractedContent(extracted)).not.toThrow();
    expect(extracted.pageType).toBe("discussion");
    expect(extracted.title).toContain("Sync conflicts");
  });

  it("captures the issue body as the root item", () => {
    const root = extracted.discussionItems[0];
    expect(root.parentId).toBeNull();
    expect(root.text).toContain("Since 2.4.0");
    expect(root.author).toBe("maintainer_bot");
    expect(root.permalink).toBe(GH_URL);
  });

  it("captures comments with reaction scores and permalinks", () => {
    const items = extracted.discussionItems;
    expect(items.length).toBe(3); // body + 2 comments
    const a = items.find((d) => d.author === "contributor_a")!;
    expect(a.score).toBe(14);
    expect(a.permalink).toContain("#issuecomment-101");
    expect(a.text).toContain("segmenter splits large docs");
  });

  it("derives comment depth from nesting/data-depth", () => {
    const b = extracted.discussionItems.find((d) => d.author === "contributor_b")!;
    expect(b.depth).toBe(1);
  });
});

describe("YouTube extraction", () => {
  it("captures transcript segments with timestamps when the panel is open", () => {
    const dom = new JSDOM(fixtures("youtube-transcript.html"), { url: YT_URL });
    const extracted = YouTubeAdapter.extract(dom.window.document, YT_URL);

    expect(() => assertExtractedContent(extracted)).not.toThrow();
    expect(extracted.pageType).toBe("video");
    expect(extracted.captureScope).toBe("transcript");
    expect(extracted.mainContent.length).toBe(3);
    expect(extracted.mainContent[0].id).toBe("timestamp-1");
    expect(extracted.mainContent[0].text).toContain("[0:00]");
    expect(extracted.mainContent[0].headingPath).toEqual(["Transcript"]);
    expect(extracted.author).toBe("LocalFirst Dev");
    expect(extracted.publishedAt).toBe("2026-06-01T10:00:00Z");
  });

  it("falls back to description with an honest warning when no transcript", () => {
    const dom = new JSDOM(fixtures("youtube-watch.html"), { url: YT_URL });
    const extracted = YouTubeAdapter.extract(dom.window.document, YT_URL);

    expect(extracted.captureScope).toBe("loaded_content");
    expect(extracted.mainContent.length).toBe(1);
    expect(extracted.mainContent[0].id).toBe("paragraph-1");
    expect(extracted.mainContent[0].text).toContain("CRDT-backed notes app");
    expect(
      extracted.extractionWarnings.some((w) => w.code === "transcript_not_available")
    ).toBe(true);
  });
});
