import { describe, it, expect, beforeAll } from "vitest";

/**
 * Auth is compiled in at module load (REQUIRED_KEY), so this suite sets the
 * env var BEFORE importing the app and uses a fresh module registry.
 */

describe("API auth (SIGNALTAP_API_KEY set)", () => {
  let app: typeof import("../src/index").app;

  beforeAll(async () => {
    process.env.SIGNALTAP_API_KEY = "test-secret-key";
    const mod = await import("../src/index");
    app = mod.app;
  });

  const payload = {
    schemaVersion: "1.0",
    url: "https://example.com/auth-test",
    profile: "general",
    extracted: {
      schemaVersion: "1.0",
      adapter: "GenericArticleAdapter",
      adapterVersion: "1.0.0",
      pageType: "article",
      url: "https://example.com/auth-test",
      mainContent: [
        { id: "paragraph-1", text: "Some factual content with 42% stats.", position: 1 },
      ],
      discussionItems: [],
      captureScope: "full_page",
      extractionWarnings: [],
    },
  };

  it("rejects analysis without a key with 401 unauthorized", async () => {
    const res = await app.request("/v1/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("unauthorized");
    expect(body.error.retryable).toBe(false);
  });

  it("rejects a wrong key with 401", async () => {
    const res = await app.request("/v1/analysis", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signaltap-key": "wrong" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(401);
  });

  it("accepts analysis with the correct key", async () => {
    const res = await app.request("/v1/analysis", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signaltap-key": "test-secret-key",
      },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
  });

  it("protects /v1/feedback too", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        analysisId: "a1",
        url: "https://example.com/auth-test",
        rating: "up",
      }),
    });
    expect(res.status).toBe(401);
  });
});
