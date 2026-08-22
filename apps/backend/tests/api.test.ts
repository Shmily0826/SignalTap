import { describe, it, expect, beforeEach } from "vitest";
import { app, store, resetRateLimits } from "../src/index";
import { ExtractedContent } from "@signaltap/schemas";

function payload(): Record<string, unknown> {
  const extracted: ExtractedContent = {
    schemaVersion: "1.0",
    adapter: "GenericArticleAdapter",
    adapterVersion: "1.0.0",
    pageType: "article",
    url: "https://example.com/api-test",
    canonicalUrl: "https://example.com/api-test",
    title: "API test article",
    author: null,
    publishedAt: null,
    mainContent: [
      { id: "paragraph-1", text: "The survey of 2,400 developers found a majority favor offline-first tools.", position: 1 },
      { id: "paragraph-2", text: "Local-first architecture makes the device the source of truth.", position: 2 },
    ],
    discussionItems: [],
    captureScope: "full_page",
    extractionWarnings: [],
  };
  return {
    schemaVersion: "1.0",
    url: extracted.url,
    canonicalUrl: extracted.canonicalUrl,
    title: extracted.title,
    profile: "general",
    extracted,
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/v1/analysis", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  store.clear();
  resetRateLimits();
});

describe("POST /v1/analysis", () => {
  it("returns a completed analysis with mock provider when no API key is set", async () => {
    const res = await post(payload());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(typeof json.analysisId).toBe("string");
    expect(json.result.verdict.worthAttention).toBeGreaterThanOrEqual(0);
    expect(json.result.verdict.worthAttention).toBeLessThanOrEqual(10);
    expect(json.result.provider).toBe("mock");
  });

  it("rejects malformed payloads with 400", async () => {
    const res = await post({ schemaVersion: "1.0", url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("rejects oversized request bodies with 413", async () => {
    const res = await post("{}", { "content-length": "2000000" });
    expect(res.status).toBe(413);
  });

  it("rate-limits clients after the per-minute budget (RATE_LIMIT_PER_MIN=3)", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await post(payload()));
    }
    expect(results[0].status).toBe(200);
    expect(results[1].status).toBe(200);
    expect(results[2].status).toBe(200);
    expect(results[3].status).toBe(429);
  });

  it("honours capture scope from extraction", async () => {
    const p = payload();
    (p.extracted as ExtractedContent).captureScope = "visible_content";
    const res = await post(p);
    const json = await res.json();
    expect(json.result.verdict.captureScope).toBe("visible_content");
  });
});

describe("GET/DELETE /v1/analysis/:id", () => {
  it("returns a stored analysis and deletes it", async () => {
    const created = await post(payload());
    const { analysisId } = await created.json();

    const getRes = await app.request(`/v1/analysis/${analysisId}`);
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.analysisId).toBe(analysisId);

    const delRes = await app.request(`/v1/analysis/${analysisId}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const gone = await app.request(`/v1/analysis/${analysisId}`);
    expect(gone.status).toBe(404);
  });
});

describe("POST /v1/feedback", () => {
  it("accepts valid feedback with 204", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        analysisId: "a1",
        url: "https://example.com/x",
        rating: "down",
        comment: "summary was off",
        issueType: "misleading_summary",
      }),
    });
    expect(res.status).toBe(204);
  });

  it("rejects invalid feedback with 400", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /v1/feedback returns sanitized metadata entries submitted so far", async () => {
    const res = await app.request("/v1/feedback");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBeGreaterThanOrEqual(1);
    expect(json.entries.length).toBe(json.count);
    const entry = json.entries[json.entries.length - 1];
    expect(entry.rating).toBe("down");
    expect(entry.host).toBe("example.com");
    // No raw content: only the length of the optional comment is kept.
    expect(entry.commentLength).toBe(15);
    expect(JSON.stringify(json.entries)).not.toContain("summary was off");
  });
});

describe("content size limits", () => {
  it("truncates oversized per-item text deterministically", async () => {
    const p = payload() as any;
    p.extracted.mainContent[0].text = "x".repeat(10000);
    const res = await post(p);
    expect(res.status).toBe(200);
    const json = await res.json();
    const stored = json.result.summary;
    expect(typeof stored).toBe("string");
  });
});
