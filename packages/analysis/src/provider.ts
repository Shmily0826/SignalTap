import {
  AnalysisRequest,
  AnalysisResult,
  ExtractedContent,
  SourceReference,
  SourceReferenceKind,
  WorthAttentionScore,
  WorthDimension,
  WorthDimensionName,
  ProviderErrorType,
} from "@signaltap/schemas";
import { calculateWorthAttention } from "./score";
import { MockClusteringProvider, summarizeClusters, ClusterResult } from "./cluster";

export class ProviderError extends Error {
  constructor(
    public readonly type: ProviderErrorType,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
}

export interface AnalysisProvider {
  readonly name: string;
  analyze(req: AnalysisRequest, opts?: AnalyzeOptions): Promise<AnalysisResult>;
}

/* ----------------------------- error helpers ------------------------------ */

export function withAbort<T>(
  p: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProviderError("cancelled", "Analysis cancelled by user"));
      return;
    }
    const onAbort = () => {
      reject(new ProviderError("cancelled", "Analysis cancelled by user"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  signal?: AbortSignal
): Promise<T> {
  if (!signal && ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ProviderError("timeout", `Analysis timed out after ${ms}ms`));
    }, ms);
    withAbort(p, signal)
      .then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      )
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      throw new ProviderError("cancelled", "Analysis cancelled by user");
    }
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const pe = e instanceof ProviderError ? e : null;
      if (pe && !pe.retryable) throw pe;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 300));
      }
    }
  }
  throw lastErr;
}

/* --------------------------- mock dimension logic ------------------------- */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const UNCERTAIN = /\b(maybe|might|could|perhaps|possibly|unsure|unclear|not sure|i think|probably|seems|appears)\b/i;
const PROMO = /\b(buy|subscribe|discount|limited offer|click here|sign up now|shop now|use code|offer ends|free trial|premium plan)\b/i;
const ACTION = /\b(how to|step|recommend|you should|try|do this|action|fix|solve|implement)\b/i;
const FACTUAL = /(\d|["“]|http|\b(study|found|report|according|data|percent|%|shows)\b)/i;

function deriveDimensions(
  extracted: ExtractedContent,
  profile: string
): WorthDimension[] {
  const paras = extracted.mainContent;
  const comments = extracted.discussionItems;

  const density = clamp(3 + paras.length / 8, 2, 9);
  const factualRatio =
    paras.length === 0
      ? 0.4
      : paras.filter((p) => FACTUAL.test(p.text)).length / paras.length;
  const evidenceQuality = clamp(2 + factualRatio * 7, 1, 9);
  const uncertaintyRatio =
    paras.length === 0
      ? 0.3
      : paras.filter((p) => UNCERTAIN.test(p.text)).length / paras.length;
  const uncertainty = clamp(2 + uncertaintyRatio * 7, 1, 9);
  const promoRatio =
    paras.length === 0
      ? 0
      : paras.filter((p) => PROMO.test(p.text)).length / paras.length;
  const promotionalIntensity = clamp(promoRatio * 9, 0, 9);
  const actionability =
    paras.some((p) => ACTION.test(p.text)) || comments.length > 0 ? 6 : 4;
  const redundancy = clamp(paras.length > 0 ? 3 + (1 - factualRatio) * 4 : 4, 1, 8);
  const novelty = comments.length > 5 ? 7 : 6;
  const relevanceBase: Record<string, number> = {
    general: 7,
    developer: 7,
    student: 7,
    researcher: 8,
    product_manager: 7,
    creator: 7,
  };
  const relevance = relevanceBase[profile] ?? 7;

  const mk = (
    name: WorthDimensionName,
    value: number,
    rationale?: string
  ): WorthDimension => ({
    name,
    value: Math.round(value * 10) / 10,
    confidence: 0.6,
    rationale,
  });

  return [
    mk("novelty", novelty, "Heuristic from discussion volume and content novelty signals."),
    mk("relevance", relevance, "Default per active relevance profile."),
    mk("evidenceQuality", evidenceQuality, "Ratio of paragraphs containing factual markers (numbers, quotes, citations)."),
    mk("informationDensity", density, "Scaled from number of extracted content blocks."),
    mk("actionability", actionability, "Presence of actionable language or active discussion."),
    mk("redundancy", redundancy, "Inverse of factual ratio."),
    mk("uncertainty", uncertainty, "Ratio of paragraphs with hedging/uncertain language."),
    mk("promotionalIntensity", promotionalIntensity, "Ratio of paragraphs with promotional language."),
  ];
}

/* ----------------------------- source helpers ----------------------------- */

function kindForParagraph(text: string): SourceReferenceKind {
  return /^#+\s/.test(text) || text.length < 80 ? "heading" : "paragraph";
}

function buildReferences(
  extracted: ExtractedContent,
  picks: { sourceId: string; kind: SourceReferenceKind; excerptFrom?: string }[]
): SourceReference[] {
  const refs: SourceReference[] = [];
  const all = [
    ...extracted.mainContent.map((m) => ({ id: m.id, text: m.text, permalink: null })),
    ...extracted.discussionItems.map((d) => ({
      id: d.id,
      text: d.text,
      permalink: d.permalink ?? null,
    })),
  ];
  const byId = new Map(all.map((x) => [x.id, x]));
  for (const pick of picks) {
    const item = byId.get(pick.sourceId);
    if (!item) continue;
    const excerpt = (pick.excerptFrom ?? item.text).slice(0, 200);
    refs.push({
      id: `ref-${refs.length + 1}`,
      sourceId: pick.sourceId,
      kind: pick.kind,
      excerpt,
      url: item.permalink ?? undefined,
    });
  }
  return refs;
}

/* ----------------------------- mock provider ------------------------------ */

export class MockAnalysisProvider implements AnalysisProvider {
  readonly name = "mock";
  private cluster = new MockClusteringProvider();

  async analyze(
    req: AnalysisRequest,
    _opts?: AnalyzeOptions
  ): Promise<AnalysisResult> {
    const extracted = req.extracted;
    const paras = extracted.mainContent;
    const comments = extracted.discussionItems;

    const dimensions = deriveDimensions(extracted, req.profile);
    const score: WorthAttentionScore = calculateWorthAttention({
      dimensions,
      profile: req.profile,
    });

    const title = extracted.title ?? "this page";
    const scopeWord =
      extracted.captureScope === "full_page"
        ? "the full article"
        : extracted.captureScope === "loaded_content"
        ? "the loaded content"
        : extracted.captureScope === "visible_content"
        ? "the visible content"
        : "the available transcript";

    const summary =
      `This ${extracted.pageType} titled "${title}" was analyzed from ${scopeWord}. ` +
      `It contains ${paras.length} content block(s)` +
      (comments.length ? ` and ${comments.length} discussion comment(s).` : ".");

    const keyFacts = paras
      .slice(0, 2)
      .map((p) => p.text.slice(0, 200).trim())
      .filter(Boolean);

    const facts = paras
      .filter((p) => FACTUAL.test(p.text))
      .slice(0, 4)
      .map((p) => p.text.slice(0, 160).trim());

    const opinions = comments
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3)
      .map((c) => `u/${c.author ?? "unknown"}: ${c.text.slice(0, 140).trim()}`);

    const speculation = paras
      .filter((p) => UNCERTAIN.test(p.text))
      .slice(0, 3)
      .map((p) => p.text.slice(0, 140).trim());

    const promotionalLanguage = paras
      .filter((p) => PROMO.test(p.text))
      .slice(0, 3)
      .map((p) => p.text.slice(0, 140).trim());

    // Discussion analysis via clustering.
    let clusterResult: ClusterResult | null = null;
    const consensus: string[] = [];
    const disagreements: string[] = [];
    const counterarguments: string[] = [];
    if (comments.length > 0) {
      clusterResult = await this.cluster.cluster(comments);
      const s = summarizeClusters(clusterResult);
      consensus.push(...s.consensus);
      disagreements.push(...s.disagreements);
      counterarguments.push(...s.counterarguments);
    }

    // Navigation: recommend sections from headings present in content.
    const recommendedSections = paras
      .filter((p) => p.headingPath && p.headingPath.length > 0)
      .slice(0, 3)
      .map((p) => ({
        label: p.headingPath!.join(" › "),
        sourceIds: [p.id],
      }));

    // Best comments: top scored.
    const bestComments = comments
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3)
      .map((c) => c.id);

    // Source references, all grounded in real extracted ids.
    const picks: { sourceId: string; kind: SourceReferenceKind }[] = [];
    paras.slice(0, 3).forEach((p) =>
      picks.push({ sourceId: p.id, kind: kindForParagraph(p.text) })
    );
    bestComments.forEach((id) =>
      picks.push({ sourceId: id, kind: "comment" as SourceReferenceKind })
    );
    const sourceReferences = buildReferences(extracted, picks);

    const readingMinutes = Math.max(
      1,
      Math.round((paras.join(" ").split(/\s+/).length || 200) / 200)
    );
    const timeSaved = Math.max(1, Math.round(readingMinutes * 0.4));

    return {
      schemaVersion: "1.0",
      provider: this.name,
      promptVersion: "mock-1.0",
      verdict: {
        worthAttention: score.score,
        confidence: score.confidence,
        reason:
          score.score >= 7
            ? "Dense, evidence-backed content worth your time."
            : score.score >= 4
            ? "Mixed value; skim the highlighted sections."
            : "Low signal-to-effort ratio; consider skipping.",
        estimatedReadingMinutes: readingMinutes,
        estimatedTimeSavedMinutes: timeSaved,
        captureScope: extracted.captureScope,
      },
      summary,
      keyFacts,
      context: extracted.author
        ? [`Authored by ${extracted.author}.`]
        : [],
      recommendedAction:
        comments.length > 0
          ? "Read the top comments for practical context before deciding."
          : undefined,
      facts,
      opinions,
      speculation,
      weakClaims: [],
      promotionalLanguage,
      repeatedInformation: [],
      missingContext: clusterResult
        ? [`Analysis based on ${comments.length} loaded comments, not the entire discussion.`]
        : [],
      importantUncertainty: uncertaintyNote(extracted),
      consensus,
      disagreements,
      firsthandReports: [],
      recurringConcerns: [],
      counterarguments,
      unansweredQuestions: [],
      recommendedSections,
      safeToSkip: [],
      bestComments,
      score,
      sourceReferences,
      stats: {
        mainContentCount: paras.length,
        discussionCount: comments.length,
        clusters: clusterResult?.clusters.length,
      },
    };
  }
}

function uncertaintyNote(extracted: ExtractedContent): string[] {
  if (extracted.captureScope !== "full_page") {
    return [
      `Findings reflect ${extracted.captureScope}; the page may contain more content not captured.`,
    ];
  }
  return [];
}
