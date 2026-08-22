import { describe, it, expect } from "vitest";
import {
  calculateWorthAttention,
  resolveWeights,
  scoreBand,
  DIMENSION_DIRECTIONS,
} from "@signaltap/analysis";
import { WorthDimension, WorthDimensionName } from "@signaltap/schemas";

const ALL: WorthDimensionName[] = [
  "novelty",
  "relevance",
  "evidenceQuality",
  "informationDensity",
  "actionability",
  "redundancy",
  "uncertainty",
  "promotionalIntensity",
];

function dims(values: Partial<Record<WorthDimensionName, number>>, confidence = 0.8): WorthDimension[] {
  return ALL.map((name) => ({
    name,
    value: values[name] ?? 5,
    confidence,
  }));
}

describe("resolveWeights", () => {
  const PROFILES = [
    "general",
    "developer",
    "student",
    "researcher",
    "product_manager",
    "creator",
  ] as const;

  it("returns weights for every dimension, normalized to |sum| = 1 for all profiles", () => {
    for (const p of PROFILES) {
      const w = resolveWeights(p);
      expect(Object.keys(w).sort()).toEqual([...ALL].sort());
      const sum = Object.values(w).reduce((a, b) => a + Math.abs(b), 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });

  it("re-weights by profile: researcher values evidenceQuality more than general", () => {
    const g = resolveWeights("general");
    const r = resolveWeights("researcher");
    expect(r.evidenceQuality).toBeGreaterThan(g.evidenceQuality);
    expect(r.novelty).toBeGreaterThan(g.novelty);
  });
});

describe("calculateWorthAttention", () => {
  it("returns 10 when all positive dims are 10 and negative dims are 0", () => {
    const s = calculateWorthAttention({
      dimensions: dims({
        novelty: 10,
        relevance: 10,
        evidenceQuality: 10,
        informationDensity: 10,
        actionability: 10,
        redundancy: 0,
        uncertainty: 0,
        promotionalIntensity: 0,
      }),
      profile: "general",
    });
    expect(s.score).toBe(10);
  });

  it("returns 0 when all positive dims are 0 and negative dims are 10", () => {
    const s = calculateWorthAttention({
      dimensions: dims({
        novelty: 0,
        relevance: 0,
        evidenceQuality: 0,
        informationDensity: 0,
        actionability: 0,
        redundancy: 10,
        uncertainty: 10,
        promotionalIntensity: 10,
      }),
      profile: "general",
    });
    expect(s.score).toBe(0);
  });

  it("neutral dimensions (all 5) produce a mid-range score, identical for every profile", () => {
    const scores = (["general", "developer", "researcher"] as const).map((profile) =>
      calculateWorthAttention({ dimensions: dims({}), profile }).score
    );
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(4);
      expect(s).toBeLessThanOrEqual(6);
    }
    // Uniform dimensions: weights don't matter, profiles must agree.
    expect(new Set(scores).size).toBe(1);
  });

  it("fills missing dimensions with neutral value 5 and confidence 0", () => {
    const s = calculateWorthAttention({
      dimensions: [
        { name: "novelty", value: 8, confidence: 1 },
        { name: "relevance", value: 8, confidence: 1 },
      ],
      profile: "general",
    });
    expect(s.dimensions).toHaveLength(8);
    const filled = s.dimensions.filter((d) => d.name !== "novelty" && d.name !== "relevance");
    for (const d of filled) {
      expect(d.value).toBe(5);
      expect(d.confidence).toBe(0);
    }
    // Overall confidence is the weight-average: below 1 because of the 0s.
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThan(1);
  });

  it("is deterministic: same input yields the identical score object", () => {
    const input = { dimensions: dims({ novelty: 9, redundancy: 2 }), profile: "student" as const };
    const a = calculateWorthAttention(input);
    const b = calculateWorthAttention(input);
    expect(a.score).toBe(b.score);
    expect(a.confidence).toBe(b.confidence);
    expect(a.weights).toEqual(b.weights);
  });

  it("direction map marks exactly 3 negative dimensions", () => {
    const negatives = Object.values(DIMENSION_DIRECTIONS).filter((d) => d === -1);
    expect(negatives).toHaveLength(3);
  });
});

describe("scoreBand", () => {
  it("bands at documented thresholds", () => {
    expect(scoreBand(0)).toBe("low");
    expect(scoreBand(3.9)).toBe("low");
    expect(scoreBand(4)).toBe("medium");
    expect(scoreBand(6.9)).toBe("medium");
    expect(scoreBand(7)).toBe("high");
    expect(scoreBand(10)).toBe("high");
  });
});
