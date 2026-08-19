import { AnalysisRequest } from "@signaltap/schemas";

export const MAX_REQUEST_BYTES = 1_000_000; // 1 MB
export const PER_ITEM_MAX_CHARS = 4000;
export const TOTAL_CONTENT_MAX_CHARS = 24_000;

/**
 * Enforce content size limits before sending to a provider.
 * Truncation is deterministic and never fabricates content.
 */
export function sanitizeRequest(req: AnalysisRequest): AnalysisRequest {
  const clip = (s: string, max: number) =>
    s.length > max ? s.slice(0, max) + " …[truncated]" : s;

  const mainContent = req.extracted.mainContent.map((m) => ({
    ...m,
    text: clip(m.text, PER_ITEM_MAX_CHARS),
  }));

  const discussionItems = req.extracted.discussionItems.map((d) => ({
    ...d,
    text: clip(d.text, PER_ITEM_MAX_CHARS),
  }));

  const totalChars =
    mainContent.reduce((a, m) => a + m.text.length, 0) +
    discussionItems.reduce((a, d) => a + d.text.length, 0);

  if (totalChars > TOTAL_CONTENT_MAX_CHARS) {
    // Trim from the tail of discussion items (least important for a quick verdict).
    let over = totalChars - TOTAL_CONTENT_MAX_CHARS;
    for (let i = discussionItems.length - 1; i >= 0 && over > 0; i--) {
      const reduce = Math.min(over, discussionItems[i].text.length);
      discussionItems[i] = {
        ...discussionItems[i],
        text:
          discussionItems[i].text.slice(0, discussionItems[i].text.length - reduce) +
          " …[truncated]",
      };
      over -= reduce;
    }
  }

  const canonicalUrl =
    req.canonicalUrl && /^https?:\/\//i.test(req.canonicalUrl)
      ? req.canonicalUrl
      : undefined;

  return {
    ...req,
    canonicalUrl,
    extracted: {
      ...req.extracted,
      mainContent,
      discussionItems,
    },
  };
}
