import { DiscussionItem, ExtractedContent } from "@signaltap/schemas";
import { Adapter } from "./types";
import {
  SIGNAL_ATTR,
  cleanText,
  computeParents,
  hostname,
  isVisible,
} from "./dom";

const ADAPTER_ID = "HackerNewsAdapter";
const ADAPTER_VERSION = "1.0.0";

export const HackerNewsAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  supports(url) {
    const host = hostname(url);
    return host === "news.ycombinator.com" || host.endsWith(".ycombinator.com");
  },

  extract(doc, url) {
    const title =
      doc.querySelector(".titleline a, .storylink")?.textContent?.trim() ||
      doc.title ||
      null;
    const storyTextEl = doc.querySelector(".toptext");

    const discussionItems: DiscussionItem[] = [];
    let cCount = 0;

    if (storyTextEl) {
      const id = `comment-${++cCount}`;
      storyTextEl.setAttribute(SIGNAL_ATTR, id);
      discussionItems.push({
        id,
        parentId: null,
        author: null,
        text: cleanText(storyTextEl.textContent ?? ""),
        score: 0,
        depth: 0,
        permalink: url,
        position: cCount,
      });
    }

    const rows = Array.from(doc.querySelectorAll<HTMLElement>("tr.comtr"));
    for (const row of rows) {
      if (!isVisible(row)) continue;
      const textEl = row.querySelector<HTMLElement>(".commtext");
      const raw = cleanText(textEl?.textContent ?? "");
      const deleted = /\[deleted\]|\[flagged\]/i.test(raw);
      if (!raw && !deleted) continue;

      const id = `comment-${++cCount}`;
      row.setAttribute(SIGNAL_ATTR, id);

      // HN indent column: width = depth * 40.
      let depth = 0;
      const indentImg = row.querySelector<HTMLImageElement>("td.ind img");
      if (indentImg) {
        const w = parseInt(indentImg.getAttribute("width") ?? "0", 10);
        if (!Number.isNaN(w)) depth = Math.round(w / 40);
      } else {
        const attr = row.getAttribute("data-depth");
        if (attr !== null) depth = parseInt(attr, 10) || 0;
      }

      const permalink =
        row.querySelector<HTMLAnchorElement>('a[href^="item?id="]')?.href || null;
      const scoreEl = row.querySelector(".score");
      const score = parseInt((scoreEl?.textContent ?? "0").replace(/[^\d-]/g, ""), 10) || 0;

      discussionItems.push({
        id,
        parentId: null,
        author: row.querySelector(".hnuser")?.textContent?.trim() ?? null,
        text: deleted ? "[deleted]" : raw,
        score,
        depth,
        permalink,
        position: cCount,
        deleted,
      });
    }

    computeParents(
      discussionItems.map((d) => ({ id: d.id, depth: d.depth, parentId: d.parentId ?? null }))
    ).forEach((p) => {
      const item = discussionItems.find((d) => d.id === p.id);
      if (item) item.parentId = p.parentId;
    });

    return {
      schemaVersion: "1.0",
      adapter: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      pageType: "discussion",
      url,
      canonicalUrl: null,
      title,
      author: null,
      publishedAt: null,
      mainContent: [],
      discussionItems,
      captureScope: "loaded_content",
      extractionWarnings: [
        {
          code: "comments_loaded_subset",
          message: `Analysis covers the ${discussionItems.length} comment(s) currently loaded, not the entire thread.`,
        },
      ],
    };
  },

  getSourceElement(sourceId, doc) {
    return doc.querySelector(`[${SIGNAL_ATTR}="${CSS.escape(sourceId)}"]`);
  },
};
