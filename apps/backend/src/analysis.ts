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
} from "@signaltap/analysis";

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
  const provider = buildProvider();
  const timeoutMs = Number(process.env.ANALYSIS_TIMEOUT_MS ?? 60000);
  const retries = Number(process.env.ANALYSIS_RETRIES ?? 1);

  try {
    return await withTimeout(
      withRetry(() => provider.analyze(req, { signal }), {
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
      return mock.analyze(req, { signal });
    }
    throw e;
  }
}
