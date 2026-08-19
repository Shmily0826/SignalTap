import { ExtractedContent, MainContentItem } from "@signaltap/schemas";
import { Adapter } from "./types";
import { SIGNAL_ATTR, cleanText, extractDiscussionItems, isNoise, isVisible } from "./dom";

const ADAPTER_ID = "GenericVisibleTextAdapter";
const ADAPTER_VERSION = "1.0.0";

export const GenericVisibleTextAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  supports() {
    return true; // last-resort fallback
  },

  extract(doc, url) {
    const mainContent: MainContentItem[] = [];
    const seen = new Set<string>();
    let n = 0;

    const blocks = doc.querySelectorAll<HTMLElement>("p, li, h1, h2, h3, h4, blockquote");
    for (const el of blocks) {
      if (isNoise(el) || !isVisible(el)) continue;
      const text = cleanText(el.textContent ?? "");
      if (text.length < 20 || seen.has(text)) continue;
      seen.add(text);
      const id = `text-${++n}`;
      el.setAttribute(SIGNAL_ATTR, id);
      mainContent.push({
        id,
        text: text.slice(0, 2000),
        headingPath: undefined,
        position: n,
      });
      if (mainContent.length >= 120) break; // hard cap for safety
    }

    return {
      schemaVersion: "1.0",
      adapter: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      pageType: "generic",
      url,
      canonicalUrl: null,
      title: doc.title || null,
      author: null,
      publishedAt: null,
      mainContent,
      discussionItems: extractDiscussionItems(doc),
      captureScope: "visible_content",
      extractionWarnings: [
        {
          code: "generic_fallback",
          message:
            "This page type was not recognized; only visible text blocks were captured. SignalTap can only see the text that was loaded on screen.",
        },
      ],
    };
  },

  getSourceElement(sourceId, doc) {
    return doc.querySelector(`[${SIGNAL_ATTR}="${CSS.escape(sourceId)}"]`);
  },
};
