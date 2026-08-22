import { z } from "zod";

/**
 * Shared schemas for SignalTap.
 *
 * These schemas are the contract between:
 *  - the browser extension (extraction + UI)
 *  - the analysis providers (mock or real LLM)
 *  - the backend API
 *
 * Everything that crosses a trust boundary (page content -> model,
 * model output -> UI) is validated against these schemas.
 */

export const SCHEMA_VERSION = "1.0";

export const PageType = z.enum(["article", "discussion", "video", "generic"]);
export type PageType = z.infer<typeof PageType>;

export const CaptureScope = z.enum([
  "full_page",
  "loaded_content",
  "visible_content",
  "transcript",
]);
export type CaptureScope = z.infer<typeof CaptureScope>;

export const RelevanceProfile = z.enum([
  "general",
  "developer",
  "student",
  "researcher",
  "product_manager",
  "creator",
]);
export type RelevanceProfile = z.infer<typeof RelevanceProfile>;

export const ExtractionWarning = z.object({
  code: z.string(),
  message: z.string(),
});
export type ExtractionWarning = z.infer<typeof ExtractionWarning>;

export const MainContentItem = z.object({
  id: z.string(),
  text: z.string(),
  headingPath: z.array(z.string()).optional(),
  position: z.number().int(),
});
export type MainContentItem = z.infer<typeof MainContentItem>;

export const DiscussionItem = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  author: z.string().nullable(),
  text: z.string(),
  score: z.number().int().default(0),
  depth: z.number().int().min(0).default(0),
  permalink: z.string().nullable().optional(),
  position: z.number().int(),
  deleted: z.boolean().optional(),
  collapsed: z.boolean().optional(),
});
export type DiscussionItem = z.infer<typeof DiscussionItem>;

export const ExtractedContent = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  adapter: z.string(),
  adapterVersion: z.string(),
  pageType: PageType,
  url: z.string(),
  canonicalUrl: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  mainContent: z.array(MainContentItem).default([]),
  discussionItems: z.array(DiscussionItem).default([]),
  captureScope: CaptureScope,
  extractionWarnings: z.array(ExtractionWarning).default([]),
});
export type ExtractedContent = z.infer<typeof ExtractedContent>;

/* ----------------------------- Analysis request ---------------------------- */

export const AnalysisRequest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  url: z.string().url(),
  canonicalUrl: z.string().url().nullable().optional(),
  title: z.string().nullable().optional(),
  profile: RelevanceProfile.default("general"),
  extracted: ExtractedContent,
  options: z
    .object({
      maxContentChars: z.number().int().positive().optional(),
      enableClustering: z.boolean().optional(),
    })
    .optional(),
});
export type AnalysisRequest = z.infer<typeof AnalysisRequest>;

/* ------------------------------ Worth score -------------------------------- */

/**
 * Explicit, documented dimensions used to compute the worth-attention score.
 * Each is rated 0..10 by the model (or deterministically derived) with a
 * confidence 0..1. The final score is a transparent weighted combination.
 */
export const WorthDimensionName = z.enum([
  "novelty",
  "relevance",
  "evidenceQuality",
  "informationDensity",
  "actionability",
  "redundancy",
  "uncertainty",
  "promotionalIntensity",
]);
export type WorthDimensionName = z.infer<typeof WorthDimensionName>;

export const WorthDimension = z.object({
  name: WorthDimensionName,
  /** 0..10 */
  value: z.number().min(0).max(10),
  /** 0..1 */
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
});
export type WorthDimension = z.infer<typeof WorthDimension>;

export const WorthAttentionScore = z.object({
  /** 0..10, content-prioritization aid, NOT an objective truth score. */
  score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  dimensions: z.array(WorthDimension),
  weights: z.record(WorthDimensionName, z.number()),
  profile: RelevanceProfile,
});
export type WorthAttentionScore = z.infer<typeof WorthAttentionScore>;

/* --------------------------- Source references ----------------------------- */

export const SourceReferenceKind = z.enum([
  "paragraph",
  "heading",
  "comment",
  "timestamp",
]);
export type SourceReferenceKind = z.infer<typeof SourceReferenceKind>;

export const SourceReference = z.object({
  id: z.string(),
  sourceId: z.string(),
  kind: SourceReferenceKind,
  excerpt: z.string(),
  /** Optional stable URL (comment permalink, timestamp deep-link). Never fabricated. */
  url: z.string().url().nullable().optional(),
});
export type SourceReference = z.infer<typeof SourceReference>;

/* ------------------------------ Analysis result ---------------------------- */

export const AnalysisResult = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  analysisId: z.string().optional(),
  generatedAt: z.string().optional(),
  provider: z.string().optional(),
  promptVersion: z.string().optional(),
  verdict: z.object({
    worthAttention: z.number().min(0).max(10),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
    estimatedReadingMinutes: z.number().int().nonnegative().nullable().optional(),
    estimatedTimeSavedMinutes: z.number().int().nonnegative().nullable().optional(),
    captureScope: CaptureScope,
  }),
  summary: z.string(),
  keyFacts: z.array(z.string()).default([]),
  context: z.array(z.string()).default([]),
  recommendedAction: z.string().nullable().optional(),
  // Information quality
  facts: z.array(z.string()).default([]),
  opinions: z.array(z.string()).default([]),
  speculation: z.array(z.string()).default([]),
  weakClaims: z.array(z.string()).default([]),
  promotionalLanguage: z.array(z.string()).default([]),
  repeatedInformation: z.array(z.string()).default([]),
  missingContext: z.array(z.string()).default([]),
  importantUncertainty: z.array(z.string()).default([]),
  // Discussion analysis
  consensus: z.array(z.string()).default([]),
  disagreements: z.array(z.string()).default([]),
  firsthandReports: z.array(z.string()).default([]),
  recurringConcerns: z.array(z.string()).default([]),
  counterarguments: z.array(z.string()).default([]),
  unansweredQuestions: z.array(z.string()).default([]),
  // Navigation
  recommendedSections: z
    .array(
      z.object({
        label: z.string(),
        sourceIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
  safeToSkip: z
    .array(
      z.object({
        label: z.string(),
        sourceIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
  bestComments: z.array(z.string()).default([]),
  // Scoring
  score: WorthAttentionScore.optional(),
  // Grounding
  sourceReferences: z.array(SourceReference).default([]),
  /** Grounding/diagnostic warnings appended post-analysis (e.g. grounding_dropped). */
  warnings: z.array(ExtractionWarning).default([]),
  // Diagnostics (no sensitive content)
  stats: z
    .object({
      mainContentCount: z.number().int().nonnegative(),
      discussionCount: z.number().int().nonnegative(),
      clusters: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

/* -------------------------------- Feedback --------------------------------- */

export const Feedback = z.object({
  analysisId: z.string(),
  url: z.string().url(),
  rating: z.enum(["up", "down", "report"]),
  comment: z.string().max(2000).optional(),
  issueType: z
    .enum([
      "incorrect_fact",
      "misleading_summary",
      "bad_source_link",
      "prompt_injection",
      "other",
    ])
    .optional(),
});
export type Feedback = z.infer<typeof Feedback>;

/* ---------------------------- Provider errors ------------------------------ */

export const ProviderErrorType = z.enum([
  "timeout",
  "rate_limited",
  "invalid_output",
  "provider_unavailable",
  "content_too_large",
  "cancelled",
  "unauthorized",
  "unknown",
]);
export type ProviderErrorType = z.infer<typeof ProviderErrorType>;

/* ----------------------- Stored analysis (cache) --------------------------- */

export const StoredAnalysis = z.object({
  key: z.string(),
  url: z.string(),
  canonicalUrl: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  profile: RelevanceProfile,
  adapter: z.string(),
  adapterVersion: z.string(),
  contentFingerprint: z.string(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  result: AnalysisResult,
  createdAt: z.string(),
});
export type StoredAnalysis = z.infer<typeof StoredAnalysis>;

export const API_ERROR_SCHEMA_VERSION = "1.0";

export const ApiError = z.object({
  schemaVersion: z.literal(API_ERROR_SCHEMA_VERSION),
  error: z.object({
    type: ProviderErrorType,
    message: z.string(),
    retryable: z.boolean().default(false),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Validate unknown model output; throws on mismatch. Used as the safety gate. */
export function assertAnalysisResult(value: unknown): AnalysisResult {
  return AnalysisResult.parse(value);
}

export function assertExtractedContent(value: unknown): ExtractedContent {
  return ExtractedContent.parse(value);
}
