import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  AnalysisRequest,
  ApiError,
  Feedback,
  AnalysisResult,
  ProviderErrorType,
  SCHEMA_VERSION,
} from "@signaltap/schemas";
import { ProviderError } from "@signaltap/analysis";
import { runAnalysis } from "./analysis";
import { sanitizeRequest, MAX_REQUEST_BYTES } from "./validation";

const PORT = Number(process.env.PORT ?? 8787);
const REQUIRED_KEY = process.env.SIGNALTAP_API_KEY ?? "";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "";
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN ?? 20);

type Stored = { status: "completed" | "failed"; result?: AnalysisResult };
const store = new Map<string, Stored>();
const feedbackLog: unknown[] = [];

// Simple fixed-window rate limiter (per origin key).
const windows = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now > w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  w.count += 1;
  return w.count > RATE_LIMIT;
}

/** Test hook: clears the in-memory rate-limit windows. */
export function resetRateLimits(): void {
  windows.clear();
}

function errorRes(
  type: ProviderErrorType,
  message: string,
  status: number,
  retryable = false
) {
  const body: ApiError = {
    schemaVersion: "1.0",
    error: { type, message, retryable },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientKey(c: any): string {
  if (REQUIRED_KEY && c.req.header("x-signaltap-key") === REQUIRED_KEY) {
    return `key:${REQUIRED_KEY}`;
  }
  return (
    c.req.header("x-forwarded-for") ||
    c.req.header("cf-connecting-ip") ||
    "local"
  );
}

const app = new Hono();

// CORS: explicit CORS_ORIGIN=* opens everything (local dev opt-in only).
// Unset (default): only extension origins and localhost may call the API.
const CORS_LIST = CORS_ORIGIN.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const EXTENSION_ORIGIN =
  /^(chrome|edge|moz)-extension:\/\/[a-z0-9]{32}$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  "*",
  cors({
    origin: (origin: string) => {
      if (CORS_LIST.includes("*")) return origin ?? "*";
      // Non-browser clients (curl, tests, service workers without Origin) pass.
      if (!origin) return undefined;
      const allow =
        CORS_LIST.includes(origin) ||
        EXTENSION_ORIGIN.test(origin) ||
        LOCAL_ORIGIN.test(origin);
      return allow ? origin : undefined;
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "x-signaltap-key"],
  })
);

// Reject oversized bodies early.
app.use("*", async (c, next) => {
  const len = Number(c.req.header("content-length") || 0);
  if (len > MAX_REQUEST_BYTES) {
    return errorRes("content_too_large", "Request body too large", 413, false);
  }
  return next();
});

app.get("/health", (c) => c.json({ ok: true, schemaVersion: SCHEMA_VERSION }));

app.post("/v1/analysis", async (c) => {
  // Auth: enforced only when SIGNALTAP_API_KEY is set (empty = open dev mode).
  if (REQUIRED_KEY && c.req.header("x-signaltap-key") !== REQUIRED_KEY) {
    return errorRes("unauthorized", "Missing or invalid API key", 401);
  }
  // Rate limit.
  if (rateLimited(clientKey(c))) {
    return errorRes("rate_limited", "Rate limit exceeded", 429, true);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorRes("invalid_output", "Body is not valid JSON", 400);
  }

  const parsed = AnalysisRequest.safeParse(body);
  if (!parsed.success) {
    return errorRes(
      "invalid_output",
      "Request failed schema validation",
      400
    );
  }

  const sanitized = sanitizeRequest(parsed.data);

  // Privacy-safe metadata logging only.
  try {
    const host = new URL(sanitized.url).host;
    const start = Date.now();
    const result = await runAnalysis(sanitized, c.req.raw.signal);
    const ms = Date.now() - start;
    console.log("[analysis]", {
      host,
      pageType: sanitized.extracted.pageType,
      main: sanitized.extracted.mainContent.length,
      disc: sanitized.extracted.discussionItems.length,
      provider: result.provider,
      score: result.verdict.worthAttention,
      ms,
    });
    const analysisId =
      (globalThis.crypto?.randomUUID?.() ?? `a_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    store.set(analysisId, { status: "completed", result });
    return c.json({ analysisId, status: "completed", result });
  } catch (e) {
    if (e instanceof ProviderError) {
      const status =
        e.type === "rate_limited"
          ? 429
          : e.type === "content_too_large"
          ? 413
          : 502;
      return errorRes(e.type, e.message, status, e.retryable);
    }
    console.error("[analysis] unexpected", e);
    return errorRes("unknown", "Analysis failed", 500);
  }
});

app.get("/v1/analysis/:id", (c) => {
  const id = c.req.param("id");
  const rec = store.get(id);
  if (!rec) return errorRes("unknown", "Analysis not found", 404);
  return c.json({ analysisId: id, status: rec.status, result: rec.result });
});

app.delete("/v1/analysis/:id", (c) => {
  const id = c.req.param("id");
  store.delete(id);
  return new Response(null, { status: 204 });
});

app.post("/v1/feedback", async (c) => {
  if (REQUIRED_KEY && c.req.header("x-signaltap-key") !== REQUIRED_KEY) {
    return errorRes("unauthorized", "Missing or invalid API key", 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorRes("invalid_output", "Body is not valid JSON", 400);
  }
  const parsed = Feedback.safeParse(body);
  if (!parsed.success) {
    return errorRes("invalid_output", "Feedback failed validation", 400);
  }
  // No raw content: store only metadata + optional non-sensitive comment.
  feedbackLog.push({
    at: new Date().toISOString(),
    analysisId: parsed.data.analysisId,
    host: safeHost(parsed.data.url),
    rating: parsed.data.rating,
    issueType: parsed.data.issueType ?? null,
    commentLength: parsed.data.comment?.length ?? 0,
  });
  return new Response(null, { status: 204 });
});

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "unknown";
  }
}

// Validate that error helper returns ApiError-compatible shape at boot.

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`SignalTap backend listening on http://localhost:${info.port}`);
  });
}

export { app, store };
