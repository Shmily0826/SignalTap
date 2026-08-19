import {
  RelevanceProfile,
  WorthAttentionScore,
  WorthDimension,
  WorthDimensionName,
} from "@signaltap/schemas";

/**
 * Worth-attention scoring.
 *
 * The score is NOT invented by the model. It is a transparent weighted
 * combination of explicit, documented dimensions, each rated 0..10 with a
 * confidence 0..1.
 *
 * Positive dimensions raise the score; negative dimensions lower it:
 *  - positive: novelty, relevance, evidenceQuality, informationDensity, actionability
 *  - negative: redundancy, uncertainty, promotionalIntensity
 */

export type DimensionDirection = 1 | -1;

export const DIMENSION_DIRECTIONS: Record<WorthDimensionName, DimensionDirection> =
  {
    novelty: 1,
    relevance: 1,
    evidenceQuality: 1,
    informationDensity: 1,
    actionability: 1,
    redundancy: -1,
    uncertainty: -1,
    promotionalIntensity: -1,
  };

/**
 * Base weights (sum of absolute values = 1.0). Profiles re-weight relevance
 * and a couple of others to reflect what each reader cares about.
 */
const BASE_WEIGHTS: Record<WorthDimensionName, number> = {
  novelty: 0.14,
  relevance: 0.22,
  evidenceQuality: 0.16,
  informationDensity: 0.14,
  actionability: 0.1,
  redundancy: 0.08,
  uncertainty: 0.08,
  promotionalIntensity: 0.08,
};

const PROFILE_WEIGHTS: Record<
  RelevanceProfile,
  Partial<Record<WorthDimensionName, number>>
> = {
  general: { relevance: 0.22 },
  developer: { evidenceQuality: 0.2, actionability: 0.16, relevance: 0.18 },
  student: { informationDensity: 0.2, evidenceQuality: 0.18 },
  researcher: { evidenceQuality: 0.26, novelty: 0.22, redundancy: 0.12 },
  product_manager: { actionability: 0.2, relevance: 0.24, novelty: 0.12 },
  creator: { novelty: 0.22, actionability: 0.18, informationDensity: 0.16 },
};

export function resolveWeights(
  profile: RelevanceProfile
): Record<WorthDimensionName, number> {
  const override = PROFILE_WEIGHTS[profile] ?? {};
  const merged = { ...BASE_WEIGHTS, ...override };
  // Re-normalize so absolute weights sum to 1.0
  const absSum = Object.values(merged).reduce((a, b) => a + Math.abs(b), 0);
  const out = {} as Record<WorthDimensionName, number>;
  for (const k of Object.keys(merged) as WorthDimensionName[]) {
    out[k] = merged[k] / absSum;
  }
  return out;
}

export interface ScoreInput {
  dimensions: WorthDimension[];
  profile: RelevanceProfile;
}

/**
 * Compute the 0..10 worth-attention score from explicit dimensions.
 * Returns the normalized score, overall confidence, and the signed breakdown.
 */
export function calculateWorthAttention(input: ScoreInput): WorthAttentionScore {
  const weights = resolveWeights(input.profile);
  const byName = new Map(input.dimensions.map((d) => [d.name, d]));

  const dims: WorthDimension[] = [];
  let cumRaw = 0;
  let posMax = 0;
  let negMax = 0;
  let wConfNum = 0;
  let wAbs = 0;

  for (const name of Object.keys(weights) as WorthDimensionName[]) {
    const w = weights[name];
    const dir = DIMENSION_DIRECTIONS[name];
    const dim = byName.get(name) ?? { name, value: 5, confidence: 0 };
    cumRaw += dir * w * dim.value;
    if (dir > 0) posMax += w * 10;
    else negMax += w * 10;
    wConfNum += Math.abs(w) * dim.confidence;
    wAbs += Math.abs(w);
    dims.push({ ...dim });
  }

  const minRaw = -negMax;
  const maxRaw = posMax;
  const span = maxRaw - minRaw || 1;
  let score = (10 * (cumRaw - minRaw)) / span;
  score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));

  const confidence = wAbs > 0 ? Math.max(0, Math.min(1, wConfNum / wAbs)) : 0;

  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    dimensions: dims,
    weights,
    profile: input.profile,
  };
}

/**
 * Convenience: derive a coarse verdict band from a score.
 */
export function scoreBand(score: number): "low" | "medium" | "high" {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}
