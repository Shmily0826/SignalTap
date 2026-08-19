import { DiscussionItem, ExtractedContent } from "@signaltap/schemas";
import { Adapter } from "./types";
import {
  SIGNAL_ATTR,
  canonicalUrl,
  cleanText,
  computeParents,
  hostname,
  isVisible,
  metaContent,
} from "./dom";

const ADAPTER_ID = "RedditAdapter";
const ADAPTER_VERSION = "1.0.0";

const COMMENT_SELECTOR =
  '[data-testid="comment"], .comment, [data-sigsoil-comment="true"]';

function commentDepth(el: Element): number {
  const attr = el.getAttribute("data-depth");
  if (attr !== null) {
    const n = parseInt(attr, 10);
    if (!Number.isNaN(n)) return n;
  }
  // Count nesting of comment containers.
  let depth = 0;
  let cur = el.parentElement;
  while (cur) {
    if (cur.matches(COMMENT_SELECTOR)) depth++;
    cur = cur.parentElement;
  }
  return depth;
}

export const RedditAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  supports(url) {
    const host = hostname(url);
    return host === "reddit.com" || host.endsWith(".reddit.com");
  },

  extract(doc, url) {
    const title =
      doc.querySelector("shreddit-post h1")?.textContent?.trim() ||
      doc.querySelector('[slot="title"]')?.textContent?.trim() ||
      doc.querySelector(".Post h1")?.textContent?.trim() ||
      doc.title ||
      null;
    const author =
      doc.querySelector('[data-testid="post_author"] a, .author')?.textContent?.trim() ??
      null;
    const postBody = doc.querySelector(
      '[slot="text-body"], .Post .md, .usertext-body'
    );

    const discussionItems: DiscussionItem[] = [];
    let cCount = 0;

    // The post itself is the root item.
    if (postBody) {
      const id = `comment-${++cCount}`;
      postBody.setAttribute(SIGNAL_ATTR, id);
      discussionItems.push({
        id,
        parentId: null,
        author,
        text: cleanText(postBody.textContent ?? ""),
        score: 0,
        depth: 0,
        permalink: url,
        position: cCount,
      });
    }

    const commentEls = Array.from(doc.querySelectorAll<HTMLElement>(COMMENT_SELECTOR));
    for (const el of commentEls) {
      if (!isVisible(el)) continue;
      const textEl =
        el.querySelector<HTMLElement>(".md, .usertext-body") ?? el;
      let text = cleanText(textEl.textContent ?? "");
      const meta = el.textContent ?? "";
      const deleted = /\[(deleted|removed)\]|Comment (deleted|removed)/i.test(meta);
      if (deleted && text.length === 0) text = "[deleted]";
      if (!text && !deleted) continue;

      const id = `comment-${++cCount}`;
      el.setAttribute(SIGNAL_ATTR, id);

      const scoreEl = el.querySelector(
        '[data-testid="comment-score"], .score.unvoted, .score'
      );
      const score = parseInt((scoreEl?.textContent ?? "0").replace(/[^\d-]/g, ""), 10) || 0;
      const permalink = el
        .querySelector<HTMLAnchorElement>('a[href*="/comments/"]')
        ?.href?.split("#")[0] || null;

      discussionItems.push({
        id,
        parentId: el.getAttribute("data-parent"),
        author:
          el.querySelector('a.author, [data-testid="comment_author_link"]')
            ?.textContent?.trim() ?? null,
        text,
        score,
        depth: commentDepth(el),
        permalink,
        position: cCount,
        deleted,
        collapsed: el.hasAttribute("data-collapsed") || el.classList.contains("collapsed"),
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
      canonicalUrl: canonicalUrl(doc, url),
      title,
      author,
      publishedAt:
        doc.querySelector("time")?.getAttribute("datetime") ??
        metaContent(doc, 'meta[property="article:published_time"]'),
      mainContent: [],
      discussionItems,
      captureScope: "loaded_content",
      extractionWarnings:
        commentEls.length > 0
          ? [
              {
                code: "comments_loaded_subset",
                message: `Analysis covers the ${discussionItems.length} comment(s) currently loaded, not the entire thread.`,
              },
            ]
          : [],
    };
  },

  getSourceElement(sourceId, doc) {
    return doc.querySelector(`[${SIGNAL_ATTR}="${CSS.escape(sourceId)}"]`);
  },
};
