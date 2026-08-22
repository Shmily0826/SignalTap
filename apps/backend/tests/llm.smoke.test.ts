import { describe, it, expect } from "vitest";
import {
  AnalysisRequest,
  ExtractedContent,
  assertAnalysisResult,
} from "@signaltap/schemas";
import { OpenAIProvider } from "@signaltap/analysis";

/**
 * Real-model smoke test. Skipped unless OPENAI_API_KEY is set so CI/dev stay
 * green and free; run explicitly with:
 *   OPENAI_API_KEY=sk-... npm run test --workspace @signaltap/backend
 */

/* ------- Realistic fixtures (article + discussion, sanitized samples) ------ */

const articleExtracted: ExtractedContent = {
  schemaVersion: "1.0",
  adapter: "GenericArticleAdapter",
  adapterVersion: "1.0.0",
  pageType: "article",
  url: "https://example.com/articles/local-first-software",
  canonicalUrl: "https://example.com/articles/local-first-software",
  title: "Why local-first software is having a moment",
  author: "Jane Doe",
  publishedAt: "2026-07-14T09:00:00Z",
  mainContent: [
    {
      id: "paragraph-1",
      text: "Local-first software treats the local device as the primary source of truth and the network as an optional enhancement. A 2026 survey of 1,200 developers found 61% had evaluated at least one local-first tool in the past year.",
      position: 1,
    },
    {
      id: "paragraph-2",
      text: "The approach trades cloud convenience for ownership: your data lives in files you control, sync becomes a background concern, and offline work is the default rather than an error state.",
      position: 2,
    },
    {
      id: "heading-1",
      text: "Key takeaways",
      headingPath: ["Key takeaways"],
      position: 3,
    },
    {
      id: "paragraph-3",
      text: "CRDTs and event sourcing remain the dominant sync strategies, though critics argue the tooling is still immature for large datasets. Maybe wait another release cycle before migrating production systems.",
      position: 4,
    },
  ],
  discussionItems: [],
  captureScope: "full_page",
  extractionWarnings: [],
};

const discussionExtracted: ExtractedContent = {
  schemaVersion: "1.0",
  adapter: "RedditAdapter",
  adapterVersion: "1.0.0",
  pageType: "discussion",
  url: "https://example.com/r/dev/comments/abc123",
  canonicalUrl: null,
  title: "Anyone moved their team to local-first tooling?",
  author: "dev_op",
  publishedAt: null,
  mainContent: [
    {
      id: "paragraph-1",
      text: "We are a 12-person team considering moving our docs and notes to a local-first stack. Anyone run this in production for more than a year? What broke?",
      position: 1,
    },
  ],
  discussionItems: [
    {
      id: "comment-1",
      parentId: null,
      author: "veteran_dev",
      text: "Two years in. Sync conflicts were rough the first six months, mostly resolved after we standardized devices. Keep a nightly export until you trust it.",
      score: 48,
      depth: 0,
      permalink: "https://example.com/r/dev/comments/abc123/c1",
      position: 1,
    },
    {
      id: "comment-2",
      parentId: "comment-1",
      author: "new_hire",
      text: "The mobile story is still bad. I lost edits twice on Android when the app was killed mid-sync.",
      score: 21,
      depth: 1,
      permalink: "https://example.com/r/dev/comments/abc123/c2",
      position: 2,
    },
    {
      id: "comment-3",
      parentId: null,
      author: "skeptic_99",
      text: "Honestly this feels like nostalgia for the 2000s. Cloud docs just work and nobody on my team wants to manage files again.",
      score: 15,
      depth: 0,
      permalink: "https://example.com/r/dev/comments/abc123/c3",
      position: 3,
    },
    {
      id: "comment-4",
      parentId: "comment-3",
      author: "veteran_dev",
      text: "Fair point, but ownership matters for compliance-heavy shops. Different tools for different constraints.",
      score: 9,
      depth: 1,
      permalink: "https://example.com/r/dev/comments/abc123/c4",
      position: 4,
    },
  ],
  captureScope: "loaded_content",
  extractionWarnings: [],
};

function makeRequest(extracted: ExtractedContent): AnalysisRequest {
  return {
    schemaVersion: "1.0",
    url: extracted.url,
    canonicalUrl: extracted.canonicalUrl ?? undefined,
    title: extracted.title,
    profile: "developer",
    extracted,
  };
}

describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAIProvider real-model smoke", () => {
  it.each([
    ["article", articleExtracted],
    ["discussion", discussionExtracted],
  ])("produces schema-valid, grounded output for %s fixture", async (_name, extracted) => {
    const provider = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
      timeoutMs: 90000,
      retries: 1,
    });

    const started = Date.now();
    const result = await provider.analyze(makeRequest(extracted as ExtractedContent));
    const elapsed = Date.now() - started;

    // Schema-valid.
    expect(() => assertAnalysisResult(result)).not.toThrow();

    // Score in range and computed (present, weighted).
    expect(result.verdict.worthAttention).toBeGreaterThanOrEqual(0);
    expect(result.verdict.worthAttention).toBeLessThanOrEqual(10);
    expect(result.score).toBeDefined();
    expect(result.score!.dimensions).toHaveLength(8);

    // Grounding: every reference resolves to the extracted set, excerpts
    // are substrings of trusted text (prefix), urls are trusted permalinks.
    const trusted = new Map<string, { text: string; permalink: string | null }>();
    for (const m of extracted.mainContent)
      trusted.set(m.id, { text: m.text, permalink: null });
    for (const d of extracted.discussionItems)
      trusted.set(d.id, { text: d.text, permalink: d.permalink ?? null });
    expect(result.sourceReferences.length).toBeGreaterThan(0);
    for (const ref of result.sourceReferences) {
      const source = trusted.get(ref.sourceId);
      expect(source, `ref ${ref.sourceId} must exist in extracted set`).toBeDefined();
      expect(source!.text.startsWith(ref.excerpt.slice(0, 40))).toBe(true);
      if (ref.url) expect(ref.url).toBe(source!.permalink);
    }

    // Latency guardrail: real analyses should finish well under 90s.
    expect(elapsed).toBeLessThan(90000);

    // Sanity: summary relates to content (non-empty, mentions a real topic word).
    expect(result.summary.length).toBeGreaterThan(20);
  });
});
