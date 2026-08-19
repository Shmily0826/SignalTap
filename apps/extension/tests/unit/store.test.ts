import { describe, it, expect } from "vitest";
import { ExtractedContent } from "@signaltap/schemas";
import { contentFingerprint, cacheKey, fnv1a } from "../../src/store";

function sample(): ExtractedContent {
  return {
    schemaVersion: "1.0",
    adapter: "GenericArticleAdapter",
    adapterVersion: "1.0.0",
    pageType: "article",
    url: "https://example.com/post",
    canonicalUrl: "https://example.com/post",
    title: "Same title",
    author: null,
    publishedAt: null,
    mainContent: [
      { id: "paragraph-1", text: "First paragraph of stable content.", position: 1 },
      { id: "paragraph-2", text: "Second paragraph about the same topic.", position: 2 },
    ],
    discussionItems: [],
    captureScope: "full_page",
    extractionWarnings: [],
  };
}

describe("content fingerprinting", () => {
  it("is stable for identical content", () => {
    expect(contentFingerprint(sample())).toBe(contentFingerprint(sample()));
  });

  it("changes when a paragraph changes", () => {
    const changed = sample();
    changed.mainContent[0].text = "Completely different first paragraph.";
    expect(contentFingerprint(changed)).not.toBe(contentFingerprint(sample()));
  });

  it("changes when the adapter version changes", () => {
    const changed = sample();
    changed.adapterVersion = "1.1.0";
    expect(contentFingerprint(changed)).not.toBe(contentFingerprint(sample()));
  });

  it("changes when capture scope changes", () => {
    const changed = sample();
    changed.captureScope = "visible_content";
    expect(contentFingerprint(changed)).not.toBe(contentFingerprint(sample()));
  });

  it("cache key depends on URL, fingerprint and profile", () => {
    const e = sample();
    const k1 = cacheKey("https://example.com/post", e, "general");
    const k2 = cacheKey("https://example.com/post", e, "developer");
    const k3 = cacheKey("https://example.com/other", e, "general");
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("fnv1a is deterministic", () => {
    expect(fnv1a("hello world")).toBe(fnv1a("hello world"));
    expect(fnv1a("hello world")).not.toBe(fnv1a("hello world!"));
  });
});
