import { DiscussionItem, ExtractedContent } from "@signaltap/schemas";
import { Adapter } from "./types";
import {
  SIGNAL_ATTR,
  cleanText,
  computeParents,
  hostname,
  isVisible,
} from "./dom";

const ADAPTER_ID = "GitHubIssueAdapter";
const ADAPTER_VERSION = "1.0.0";

const COMMENT_SELECTOR = ".js-comment-container, [data-sigsoil-comment='true']";

function ghDepth(el: Element): number {
  const attr = el.getAttribute("data-depth");
  if (attr !== null) {
    const n = parseInt(attr, 10);
    if (!Number.isNaN(n)) return n;
  }
  let depth = 0;
  let cur = el.parentElement;
  while (cur) {
    if (cur.matches(COMMENT_SELECTOR)) depth++;
    cur = cur.parentElement;
  }
  return depth;
}

export const GitHubIssueAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  supports(url) {
    const host = hostname(url);
    if (host !== "github.com") return false;
    return /\/issues\/|\/discussions\/|\/pull\//.test(new URL(url).pathname);
  },

  extract(doc, url) {
    const title =
      doc.querySelector(".js-issue-title, [data-testid='issue-title'], h1.gh-header-title")
        ?.textContent?.trim() || doc.title || null;

    const discussionItems: DiscussionItem[] = [];
    let cCount = 0;

    // Issue body is the root item.
    const bodyEl = doc.querySelector(".js-comment-body, [data-testid='issue-body']");
    if (bodyEl) {
      const id = `comment-${++cCount}`;
      bodyEl.setAttribute(SIGNAL_ATTR, id);
      discussionItems.push({
        id,
        parentId: null,
        author:
          doc.querySelector(".author")?.textContent?.trim() ??
          bodyEl.closest(".TimelineItem")?.querySelector(".author")?.textContent?.trim() ??
          null,
        text: cleanText(bodyEl.textContent ?? ""),
        score: 0,
        depth: 0,
        permalink: url,
        position: cCount,
      });
    }

    const commentEls = Array.from(doc.querySelectorAll<HTMLElement>(COMMENT_SELECTOR));
    for (const el of commentEls) {
      if (el === bodyEl?.closest(".js-comment-container")) continue; // body already captured
      if (!isVisible(el)) continue;
      const textEl = el.querySelector<HTMLElement>(".markdown-body");
      const text = cleanText(textEl?.textContent ?? "");
      if (!text) continue;

      const id = `comment-${++cCount}`;
      el.setAttribute(SIGNAL_ATTR, id);

      let score = 0;
      const reactionCounts = el.querySelectorAll(".reaction-count, .js-social-reactions-count");
      for (const r of reactionCounts) {
        const n = parseInt((r.textContent ?? "").replace(/[^\d]/g, ""), 10);
        if (!Number.isNaN(n)) score += n;
      }

      discussionItems.push({
        id,
        parentId: el.getAttribute("data-parent"),
        author:
          el.querySelector(".author")?.textContent?.trim() ??
          el.querySelector('[data-testid="comment-author"]')?.textContent?.trim() ??
          null,
        text,
        score,
        depth: ghDepth(el),
        permalink:
          el.querySelector<HTMLAnchorElement>('a[href*="#issuecomment-"], a[href*="#discussion_r"]')
            ?.href || null,
        position: cCount,
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
