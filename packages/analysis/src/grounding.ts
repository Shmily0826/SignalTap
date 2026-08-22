import {
  AnalysisResult,
  ExtractedContent,
  ExtractionWarning,
  SourceReference,
  SourceReferenceKind,
} from "@signaltap/schemas";

/**
 * Trust-boundary validation for model output.
 *
 * Extracted page content is untrusted data, and so is anything the model says
 * about it. This module never trusts model-provided source metadata:
 *  - only sourceIds that exist in the extracted set survive;
 *  - excerpts are rebuilt from the trusted extracted text;
 *  - urls are rebuilt from trusted permalinks only (never model-provided);
 *  - navigation sourceIds (recommendedSections / safeToSkip / bestComments)
 *    are filtered against the same trusted id set.
 *
 * Anything dropped is reported via a `grounding_dropped` warning so the UI can
 * be honest about reduced grounding.
 */

const EXCERPT_MAX_CHARS = 200;

const VALID_KINDS: SourceReferenceKind[] = [
  "paragraph",
  "heading",
  "comment",
  "timestamp",
];

interface TrustedSource {
  text: string;
  permalink: string | null;
  isComment: boolean;
}

function buildTrustedIndex(extracted: ExtractedContent): Map<string, TrustedSource> {
  const map = new Map<string, TrustedSource>();
  for (const m of extracted.mainContent) {
    map.set(m.id, { text: m.text, permalink: null, isComment: false });
  }
  for (const d of extracted.discussionItems) {
    map.set(d.id, { text: d.text, permalink: d.permalink ?? null, isComment: true });
  }
  return map;
}

function rebuildKind(modelKind: unknown, source: TrustedSource): SourceReferenceKind {
  if (typeof modelKind === "string" && (VALID_KINDS as string[]).includes(modelKind)) {
    return modelKind as SourceReferenceKind;
  }
  return source.isComment
    ? "comment"
    : source.text.length < 80
      ? "heading"
      : "paragraph";
}

export interface GroundingReport {
  /** Number of invalid sourceReferences dropped entirely. */
  droppedReferences: number;
  /** Number of invalid navigation sourceIds (sections/skip/bestComments) dropped. */
  droppedNavigationIds: number;
}

export function validateGrounding(
  result: AnalysisResult,
  extracted: ExtractedContent
): { result: AnalysisResult; report: GroundingReport } {
  const trusted = buildTrustedIndex(extracted);
  const report: GroundingReport = { droppedReferences: 0, droppedNavigationIds: 0 };

  // 1. sourceReferences: keep only trusted ids; rebuild excerpt + url.
  const refs: SourceReference[] = [];
  for (const ref of result.sourceReferences) {
    const source = trusted.get(ref?.sourceId);
    if (!source) {
      report.droppedReferences++;
      continue;
    }
    refs.push({
      id: `ref-${refs.length + 1}`,
      sourceId: ref.sourceId,
      kind: rebuildKind(ref.kind, source),
      excerpt: source.text.slice(0, EXCERPT_MAX_CHARS),
      url: source.permalink ?? undefined,
    });
  }

  // 2. navigation sections: strip invalid ids; drop emptied entries.
  const filterSections = (
    sections: AnalysisResult["recommendedSections"]
  ): AnalysisResult["recommendedSections"] => {
    const out: AnalysisResult["recommendedSections"] = [];
    for (const s of sections) {
      const sourceIds = s.sourceIds.filter((id) => {
        if (trusted.has(id)) return true;
        report.droppedNavigationIds++;
        return false;
      });
      if (sourceIds.length > 0) out.push({ label: s.label, sourceIds });
    }
    return out;
  };
  const recommendedSections = filterSections(result.recommendedSections);
  const safeToSkip = filterSections(result.safeToSkip);

  // 3. bestComments: keep only ids that are real discussion items.
  const bestComments = result.bestComments.filter((id) => {
    const source = trusted.get(id);
    if (source?.isComment) return true;
    report.droppedNavigationIds++;
    return false;
  });

  // 4. report reductions honestly.
  const warnings: ExtractionWarning[] = [...(result.warnings ?? [])];
  const dropped = report.droppedReferences + report.droppedNavigationIds;
  if (dropped > 0) {
    warnings.push({
      code: "grounding_dropped",
      message: `Removed ${dropped} model-provided source reference(s)/id(s) that did not match the extracted content.`,
    });
  }

  return {
    result: {
      ...result,
      sourceReferences: refs,
      recommendedSections,
      safeToSkip,
      bestComments,
      warnings,
    },
    report,
  };
}
