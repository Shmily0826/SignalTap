import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, requestAnalysis } from "../../src/api";
import { AnalysisRequest } from "@signaltap/schemas";

/**
 * Unit tests for the extension's backend client. These lock in the error
 * classification the side panel relies on (rate_limited / cancelled /
 * network / HTTP status) and the schema safety gate on results.
 */

function validRequest(): AnalysisRequest {
  return {
    schemaVersion: "1.0",
    url: "https://example.com/post",
    profile: "general",
    extracted: {
      schemaVersion: "1.0",
      adapter: "GenericArticleAdapter",
      adapterVersion: "1.0.0",
      pageType: "article",
      url: "https://example.com/post",
      mainContent: [
        { id: "paragraph-1", text: "A factual sentence with 42% data.", position: 1 },
      ],
      discussionItems: [],
      captureScope: "full_page",
      extractionWarnings: [],
    },
  };
}

function validResult() {
  return {
    schemaVersion: "1.0",
    verdict: {
      worthAttention: 6.5,
      confidence: 0.7,
      reason: "Dense content",
      captureScope: "full_page",
    },
    summary: "An article about data.",
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("requestAnalysis", () => {
  it("returns the analysis on success and passes the schema gate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ analysisId: "a-1", status: "completed", result: validResult() }))
    );
    const res = await requestAnalysis(validRequest());
    expect(res.analysisId).toBe("a-1");
    expect(res.result.verdict.worthAttention).toBe(6.5);
    expect(res.result.summary).toBe("An article about data.");
  });

  it("rejects when the backend returns a schema-invalid result (safety gate)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({ analysisId: "a-2", status: "completed", result: { schemaVersion: "1.0" } })
      )
    );
    await expect(requestAnalysis(validRequest())).rejects.toThrow();
  });

  it("maps HTTP 429 to a retryable rate_limited ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );
    const err = await requestAnalysis(validRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.type).toBe("rate_limited");
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(429);
  });

  it("surfaces the backend error type and status for other failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          schemaVersion: "1.0",
          error: { type: "provider_unavailable", message: "Provider error", retryable: true },
        }),
      })
    );
    const err = await requestAnalysis(validRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.type).toBe("provider_unavailable");
    expect(err.status).toBe(502);
    expect(err.message).toContain("502");
  });

  it("maps network failure to the backend-unreachable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await requestAnalysis(validRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.type).toBe("network");
    expect(err.message).toContain("8787");
  });

  it("maps user abort to a cancelled error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"))
    );
    const err = await requestAnalysis(validRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.type).toBe("cancelled");
  });
});
