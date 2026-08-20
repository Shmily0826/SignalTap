import {
  ExtractedContent,
  ExtractionWarning,
  MainContentItem,
  DiscussionItem,
} from "@signaltap/schemas";

/**
 * Long-content strategy.
 *
 * Very long pages (long-form articles, full comment threads) would blow the
 * model context window and produce timeouts / truncated-analysis failures. We
 * cap what we send to the provider with a transparent, deterministic policy:
 *
 *  - main content is kept in document order (intro + early sections are the
 *    most central), first by block count, then by total characters;
 *  - when the character budget is tight we trim the single overflowing block
 *    rather than dropping a whole section, preserving heading structure;
 *  - discussion items are ranked by score and the top N are kept, then
 *    re-sorted by document position so the thread still reads naturally;
 *  - every reduction is reported via an extraction warning so the user (and
 *    the model) knows the analysis covers a bounded subset.
 *
 * Truncation never invents or reorders content; it only drops or trims the
 * tail. Source IDs on kept items are untouched, so click-to-highlight still
 * resolves to real DOM nodes.
 */
export interface TruncateLimits {
  /** Total characters of main content sent to the provider. */
  maxChars?: number;
  /** Maximum number of main-content blocks. */
  maxBlocks?: number;
  /** Maximum number of discussion items. */
  maxComments?: number;
}

export interface TruncateResult {
  extracted: ExtractedContent;
  truncated: boolean;
  removedBlocks: number;
  removedChars: number;
  removedComments: number;
  warnings: ExtractionWarning[];
}

export const DEFAULT_TRUNCATE_LIMITS: Required<TruncateLimits> = {
  maxChars: 24000,
  maxBlocks: 120,
  maxComments: 60,
};

function charsOf(blocks: MainContentItem[]): number {
  let n = 0;
  for (const b of blocks) n += b.text.length;
  return n;
}

export function truncateExtracted(
  e: ExtractedContent,
  limits?: TruncateLimits
): TruncateResult {
  const L = { ...DEFAULT_TRUNCATE_LIMITS, ...(limits ?? {}) };
  const warnings: ExtractionWarning[] = [];
  let truncated = false;
  let removedBlocks = 0;
  let removedChars = 0;
  let removedComments = 0;

  // --- main content ---------------------------------------------------------
  let blocks = e.mainContent;

  // Phase 1: cap by block count (keep document order / intro + early sections).
  if (blocks.length > L.maxBlocks) {
    removedBlocks += blocks.length - L.maxBlocks;
    blocks = blocks.slice(0, L.maxBlocks);
    truncated = true;
  }

  // Phase 2: cap by total characters, keeping whole blocks in order and
  // trimming the one block that would overflow the remaining budget.
  const total = charsOf(blocks);
  if (total > L.maxChars) {
    const kept: MainContentItem[] = [];
    let used = 0;
    for (const b of blocks) {
      if (used + b.text.length <= L.maxChars) {
        kept.push(b);
        used += b.text.length;
      } else {
        const remaining = L.maxChars - used;
        if (remaining > 40) {
          kept.push({ ...b, text: b.text.slice(0, remaining) });
          used = L.maxChars;
        }
        break;
      }
    }
    removedBlocks += blocks.length - kept.length;
    removedChars = total - used;
    blocks = kept;
    truncated = true;
  }

  // --- discussion items -----------------------------------------------------
  let comments = e.discussionItems;
  if (comments.length > L.maxComments) {
    // Keep the highest-scored comments, then restore document order so the
    // thread reads naturally for the model.
    const top = [...comments]
      .sort((a, b) => b.score - a.score)
      .slice(0, L.maxComments)
      .sort((a, b) => a.position - b.position);
    removedComments = comments.length - top.length;
    comments = top;
    truncated = true;
  }

  if (truncated) {
    if (removedBlocks > 0 || removedChars > 0) {
      warnings.push({
        code: "content_truncated",
        message: `Main content reduced to ${blocks.length} block(s) (~${charsOf(
          blocks
        )} chars) to stay within provider limits.`,
      });
    }
    if (removedComments > 0) {
      warnings.push({
        code: "comments_truncated",
        message: `Discussion reduced to the top ${comments.length} comments by score.`,
      });
    }
  }

  const extracted: ExtractedContent = {
    ...e,
    mainContent: blocks,
    discussionItems: comments,
    extractionWarnings: [...e.extractionWarnings, ...warnings],
  };

  return {
    extracted,
    truncated,
    removedBlocks,
    removedChars,
    removedComments,
    warnings,
  };
}
