import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { selectAdapter, ADAPTERS } from "../../src/adapters";
import { GenericArticleAdapter } from "../../src/adapters/genericArticle";
import { RedditAdapter } from "../../src/adapters/reddit";
import { HackerNewsAdapter } from "../../src/adapters/hackernews";
import { GitHubIssueAdapter } from "../../src/adapters/githubIssue";
import { YouTubeAdapter } from "../../src/adapters/youtube";
import { GenericVisibleTextAdapter } from "../../src/adapters/genericVisible";
import { assertExtractedContent } from "@signaltap/schemas";

const fixtures = (name: string) =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

describe("adapter selection", () => {
  it("selects the Reddit adapter for reddit.com URLs", () => {
    const doc = new JSDOM("<html/>").window.document;
    expect(
      selectAdapter("https://www.reddit.com/r/tech/comments/abc/thread/", doc)
    ).toBe(RedditAdapter);
  });

  it("selects the HackerNews adapter for news.ycombinator.com", () => {
    const doc = new JSDOM("<html/>").window.document;
    expect(
      selectAdapter("https://news.ycombinator.com/item?id=12345", doc)
    ).toBe(HackerNewsAdapter);
  });

  it("selects the GitHub adapter for issue pages", () => {
    const doc = new JSDOM("<html/>").window.document;
    expect(
      selectAdapter("https://github.com/owner/repo/issues/42", doc)
    ).toBe(GitHubIssueAdapter);
    expect(
      selectAdapter("https://github.com/owner/repo/discussions/7", doc)
    ).toBe(GitHubIssueAdapter);
  });

  it("selects the YouTube adapter for youtube URLs", () => {
    const doc = new JSDOM("<html/>").window.document;
    expect(selectAdapter("https://www.youtube.com/watch?v=abc", doc)).toBe(
      YouTubeAdapter
    );
  });

  it("selects GenericArticleAdapter for article pages", () => {
    const dom = new JSDOM(fixtures("article.html"), {
      url: "https://example.com/blog/local-first-software",
    });
    expect(selectAdapter("https://example.com/blog/local-first-software", dom.window.document)).toBe(
      GenericArticleAdapter
    );
  });

  it("falls back to GenericVisibleTextAdapter for unknown pages", () => {
    const dom = new JSDOM("<html><body><p>Some short text.</p></body></html>");
    expect(selectAdapter("https://unknown.example/short", dom.window.document)).toBe(
      GenericVisibleTextAdapter
    );
  });
});

describe("article extraction", () => {
  const dom = new JSDOM(fixtures("article.html"), {
    url: "https://example.com/blog/local-first-software",
  });
  const doc = dom.window.document;
  const extracted = GenericArticleAdapter.extract(
    doc,
    "https://example.com/blog/local-first-software"
  );

  it("returns valid schema with pageType article", () => {
    expect(() => assertExtractedContent(extracted)).not.toThrow();
    expect(extracted.pageType).toBe("article");
  });

  it("captures title, author, canonical URL and published date", () => {
    expect(extracted.title).toContain("local-first");
    expect(extracted.author).toBe("Ada Example");
    expect(extracted.canonicalUrl).toBe("https://example.com/blog/local-first-software");
    expect(extracted.publishedAt).toBe("2026-05-12T09:00:00Z");
  });

  it("extracts paragraphs while excluding nav, cookie banner and footer noise", () => {
    const texts = extracted.mainContent.map((m) => m.text);
    expect(texts.length).toBeGreaterThanOrEqual(8);
    expect(texts.some((t) => t.includes("cookies"))).toBe(false);
    expect(texts.some((t) => t.includes("Subscribe to our newsletter"))).toBe(false);
  });

  it("preserves heading hierarchy in headingPath", () => {
    const underH2 = extracted.mainContent.find((m) =>
      m.text.includes("The shift away from the cloud")
    );
    expect(underH2?.headingPath).toEqual([
      "Why local-first software is quietly winning",
      "The shift away from the cloud",
    ]);
  });

  it("assigns stable paragraph source IDs and annotates the DOM", () => {
    expect(extracted.mainContent.some((m) => m.id.startsWith("paragraph-"))).toBe(true);
    const first = extracted.mainContent[0];
    const el = doc.querySelector(`[data-sigsoil-id="${first.id}"]`);
    expect(el).not.toBeNull();
  });

  it("classifies capture scope as full_page for article pages", () => {
    expect(extracted.captureScope).toBe("full_page");
  });

  it("flags paywall-style language", () => {
    const dom2 = new JSDOM(fixtures("article.html").replace("survey of 2,400", "Subscribe to read this article. survey of 2,400"), {
      url: "https://example.com/blog/local-first-software",
    });
    const e2 = GenericArticleAdapter.extract(
      dom2.window.document,
      "https://example.com/blog/local-first-software"
    );
    expect(e2.extractionWarnings.some((w) => w.code === "paywall_detected")).toBe(true);
  });
});

describe("discussion normalization (Reddit fixture)", () => {
  const dom = new JSDOM(fixtures("discussion.html"), {
    url: "https://www.reddit.com/r/localdev/comments/abc/thread/",
  });
  const doc = dom.window.document;
  const extracted = RedditAdapter.extract(
    doc,
    "https://www.reddit.com/r/localdev/comments/abc/thread/"
  );

  it("returns valid schema with pageType discussion", () => {
    expect(() => assertExtractedContent(extracted)).not.toThrow();
    expect(extracted.pageType).toBe("discussion");
  });

  it("normalizes comment hierarchy (parent-child) with depth", () => {
    const items = extracted.discussionItems;
    expect(items.length).toBe(7); // post + 6 comments
    // comment-2 (depth 1) should have comment-1 as parent
    const c2 = items.find((d) => d.text.includes("Merge conflicts are the real bottleneck"));
    expect(c2?.depth).toBe(1);
    expect(c2?.parentId).toBe(items[1].id); // the first top-level comment
  });

  it("parses scores and authors", () => {
    const top = extracted.discussionItems.find((d) => d.text.includes("We moved a 12-person squad"));
    expect(top?.score).toBe(127);
    expect(top?.author).toBe("u/dev_nina");
  });

  it("marks deleted comments", () => {
    const del = extracted.discussionItems.find((d) => d.deleted);
    expect(del).toBeDefined();
    expect(del?.text).toBe("[deleted]");
  });

  it("keeps capture scope as loaded_content with a subset warning", () => {
    expect(extracted.captureScope).toBe("loaded_content");
    expect(extracted.extractionWarnings.some((w) => w.code === "comments_loaded_subset")).toBe(true);
  });
});

describe("source ID stability", () => {
  it("produces identical IDs on repeated extraction of the same document", () => {
    const dom = new JSDOM(fixtures("article.html"), {
      url: "https://example.com/blog/local-first-software",
    });
    const doc = dom.window.document;
    const a = GenericArticleAdapter.extract(doc, "https://example.com/blog/local-first-software");
    const b = GenericArticleAdapter.extract(doc, "https://example.com/blog/local-first-software");
    expect(a.mainContent.map((m) => m.id)).toEqual(b.mainContent.map((m) => m.id));
  });
});

describe("generic fallback", () => {
  it("uses visible_content scope for unrecognized pages", () => {
    const dom = new JSDOM(
      "<html><body><p>A paragraph with enough text to be captured by the fallback adapter.</p><p>Another paragraph of reasonably long text for extraction.</p></body></html>"
    );
    const adapter = selectAdapter("https://unknown.example/x", dom.window.document);
    expect(adapter).toBe(GenericVisibleTextAdapter);
    const extracted = adapter.extract(dom.window.document, "https://unknown.example/x");
    expect(extracted.captureScope).toBe("visible_content");
    expect(extracted.pageType).toBe("generic");
    expect(extracted.mainContent.length).toBe(2);
  });
});

describe("adapter registry sanity", () => {
  it("contains all expected adapters in priority order", () => {
    expect(ADAPTERS.map((a) => a.id)).toEqual([
      "YouTubeAdapter",
      "RedditAdapter",
      "HackerNewsAdapter",
      "GitHubIssueAdapter",
      "GenericArticleAdapter",
      "GenericVisibleTextAdapter",
    ]);
  });
});
