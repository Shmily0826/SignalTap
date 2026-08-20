import {
  AnalysisRequest,
  AnalysisResult,
  ProviderErrorType,
} from "@signaltap/schemas";
import {
  AnalysisProvider,
  MockAnalysisProvider,
  OpenAIProvider,
  ProviderError,
  withTimeout,
  withRetry,
  truncateExtracted,
  DEFAULT_TRUNCATE_LIMITS,
  type TruncateLimits,
} from "@signaltap/analysis";

/**
 * Provider-side length caps. Long pages are trimmed before the (potentially
 * metered) model call so we never blow the context window or pay to analyze
 * content the user will never see summarized.
 */
const TRUNCATE_LIMITS: TruncateLimits = {
  maxChars: Number(process.env.MAX_CONTENT_CHARS ?? DEFAULT_TRUNCATE_LIMITS.maxChars),
  maxBlocks: Number(process.env.MAX_CONTENT_BLOCKS ?? DEFAULT_TRUNCATE_LIMITS.maxBlocks),
  maxComments: Number(process.env.MAX_COMMENTS ?? DEFAULT_TRUNCATE_LIMITS.maxComments),
};

/**
 * Build the active provider. Real LLM is used only when an API key is
 * configured; otherwise we fall back to the deterministic mock so the
 * product loop always works offline / without secrets.
 */
export function buildProvider(): AnalysisProvider {
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    return new OpenAIProvider({
      apiKey: key,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
      timeoutMs: Number(process.env.ANALYSIS_TIMEOUT_MS ?? 60000),
      retries: Number(process.env.ANALYSIS_RETRIES ?? 1),
      promptVersion: "llm-1.0",
    });
  }
  return new MockAnalysisProvider();
}

const FALLBACK_TYPES: ProviderErrorType[] = [
  "invalid_output",
  "provider_unavailable",
];

/**
 * Run analysis with timeout + retry. On real-provider failures that are safe
 * to recover from, fall back to the mock provider so the user still gets a
 * grounded result rather than an error.
 */
export async function runAnalysis(
  req: AnalysisRequest,
  signal?: AbortSignal
): Promise<AnalysisResult> {
  // Bound what we send to the provider (long-content strategy). Both the
  // primary and the mock-fallback path analyze the same trimmed content.
  const { extracted } = truncateExtracted(req.extracted, TRUNCATE_LIMITS);
  const trimmedReq: AnalysisRequest = { ...req, extracted };

  const provider = buildProvider();
  const timeoutMs = Number(process.env.ANALYSIS_TIMEOUT_MS ?? 60000);
  const retries = Number(process.env.ANALYSIS_RETRIES ?? 1);

  try {
    return await withTimeout(
      withRetry(() => provider.analyze(trimmedReq, { signal }), {
        retries,
        signal,
      }),
      timeoutMs,
      signal
    );
  } catch (e) {
    const pe = e instanceof ProviderError ? e : null;
    if (provider.name !== "mock" && pe && FALLBACK_TYPES.includes(pe.type)) {
      const mock = new MockAnalysisProvider();
      return mock.analyze(trimmedReq, { signal });
    }
    throw e;
  }
}
