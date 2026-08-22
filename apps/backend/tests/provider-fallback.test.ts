import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { AnalysisRequest, ExtractedContent } from "@signaltap/schemas";
import { ProviderError } from "@signaltap/analysis";
import { runAnalysis } from "../src/analysis";

/**
 * runAnalysis orchestration tests: provider fallback and error
 * classification with the real OpenAI provider selected but the HTTP layer
 * stubbed. No network access, no API key cost.
 */

function makeRequest(): AnalysisRequest {
  const extracted: ExtractedContent = {
    schemaVersion: "1.0",
    adapter: "GenericArticleAdapter",
    adapterVersion: "1.0.0",
    pageType: "article",
    url: "https://example.com/fallback-test",
    canonicalUrl: null,
    title: "Fallback test",
    author: null,
    publishedAt: null,
    mainContent: [
      { id: "paragraph-1", text: "Content with 42% factual markers for scoring.", position: 1 },
      { id: "paragraph-2", text: "A second paragraph so density is non-trivial.", position: 2 },
    ],
    discussionItems: [],
    captureScope: "full_page",
    extractionWarnings: [],
  };
  return {
    schemaVersion: "1.0",
    url: extracted.url,
    profile: "general",
    extracted,
  };
}

beforeAll(() => {
  // Force the real provider branch; fetch is stubbed per-test.
  process.env.OPENAI_API_KEY = "stub-key-for-orchestration-tests";
  process.env.ANALYSIS_RETRIES = "0"; // fail fast
});

afterEach(() => vi.unstubAllGlobals());

describe("runAnalysis provider fallback", () => {
  it("falls back to the mock provider when the real provider returns 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );
    const result = await runAnalysis(makeRequest());
    // Same trimmed input, mock output: schema-valid, grounded, provider=mock.
    expect(result.provider).toBe("mock");
    expect(result.verdict.worthAttention).toBeGreaterThanOrEqual(0);
    expect(result.sourceReferences.every((r) => r.sourceId.startsWith("paragraph-"))).toBe(true);
  });

  it("falls back to the mock provider on invalid model JSON output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "this is not json" } }],
        }),
      })
    );
    const result = await runAnalysis(makeRequest());
    expect(result.provider).toBe("mock");
  });

  it("does NOT fall back on rate_limited: the error propagates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 })
    );
    await expect(runAnalysis(makeRequest())).rejects.toMatchObject({
      name: "ProviderError",
      type: "rate_limited",
    });
  });

  it("uses the mock provider directly when no API key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await runAnalysis(makeRequest());
    expect(result.provider).toBe("mock");
    expect(fetchSpy).not.toHaveBeenCalled(); // no model call at all
    process.env.OPENAI_API_KEY = "stub-key-for-orchestration-tests";
  });
});

describe("ProviderError shape reaching the API layer", () => {
  it("rate_limited errors are retryable so the route maps them to 429", async () => {
    const e = new ProviderError("rate_limited", "Provider rate limit hit", true);
    expect(e.retryable).toBe(true);
    expect(e.type).toBe("rate_limited");
  });
});
