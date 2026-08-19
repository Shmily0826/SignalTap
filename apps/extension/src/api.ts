import {
  AnalysisRequest,
  AnalysisResult,
  assertAnalysisResult,
} from "@signaltap/schemas";

export const API_BASE: string =
  ((import.meta as any).env?.VITE_API_URL as string) ?? "http://localhost:8787";

export interface AnalysisResponse {
  analysisId: string;
  status: "completed";
  result: AnalysisResult;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly type?: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestAnalysis(
  payload: AnalysisRequest,
  signal?: AbortSignal
): Promise<AnalysisResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/analysis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError("Analysis cancelled", undefined, "cancelled");
    }
    throw new ApiError(
      "Could not reach the SignalTap backend. Is it running on port 8787?",
      undefined,
      "network"
    );
  }
  if (res.status === 429) {
    throw new ApiError("Rate limit exceeded, try again in a moment", 429, "rate_limited", true);
  }
  if (!res.ok) {
    let type: string | undefined;
    try {
      const body = await res.json();
      type = body?.error?.type;
    } catch {
      /* ignore */
    }
    throw new ApiError(`Analysis failed (HTTP ${res.status})`, res.status, type);
  }
  const data = await res.json();
  const result = assertAnalysisResult(data.result); // schema safety gate
  return { analysisId: String(data.analysisId ?? ""), status: "completed", result };
}

export interface FeedbackPayload {
  analysisId: string;
  url: string;
  rating: "up" | "down" | "report";
  comment?: string;
  issueType?: string;
}

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  try {
    await fetch(`${API_BASE}/v1/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // feedback is best-effort; never block the user
  }
}

export async function deleteRemoteAnalysis(analysisId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/v1/analysis/${encodeURIComponent(analysisId)}`, {
      method: "DELETE",
    });
  } catch {
    // best-effort
  }
}
