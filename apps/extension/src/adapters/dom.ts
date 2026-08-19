/** DOM helpers shared by the extraction adapters. */

import { DiscussionItem } from "@signaltap/schemas";

declare global {
  interface CSS {
    escape(value: string): string;
  }
}

export const SIGNAL_ATTR = "data-sigsoil-id";

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function isVisible(el: Element): boolean {
  if (el.closest("[hidden]") || el.closest("[aria-hidden='true']")) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }
  return true;
}

const NOISE_SELECTOR = [
  "nav",
  "aside",
  "footer",
  "form",
  "script",
  "style",
  "noscript",
  "iframe",
  "dialog",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  "[class*='ad-']",
  "[class*='ad_']",
  "[class*='advert']",
  "[class*='cookie']",
  "[class*='consent']",
  "[class*='newsletter']",
  "[class*='share']",
  "[class*='recommend']",
  "[class*='related']",
  "[class*='paywall']",
  "[id*='advert']",
  "[id*='cookie']",
  "[data-ad-slot]",
  "[data-testid*='ad']",
].join(",");

export function isNoise(el: Element): boolean {
  return Boolean(el.closest(NOISE_SELECTOR));
}

export function assignId(el: Element, prefix: string, n: number): string {
  const id = `${prefix}-${n}`;
  el.setAttribute(SIGNAL_ATTR, id);
  return id;
}

/** Minimal attribute-value escaping for selector building (CSS.escape not in all DOM libs). */
export function cssEscapeAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function metaContent(doc: Document, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const v = el?.getAttribute("content") ?? el?.getAttribute("property");
    if (v && v.trim()) return cleanText(v);
  }
  return null;
}

export function canonicalUrl(doc: Document, fallback: string): string | null {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (link?.href) return link.href;
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (og?.content) return og.content;
  return fallback;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const PAYWALL_HINTS =
  /\b(subscribe to read|sign in to read|unlock this article|subscribe to continue|article limit reached|log in to continue)\b/i;

export function paywallHint(text: string): boolean {
  return PAYWALL_HINTS.test(text);
}

export interface DepthItem {
  id: string;
  depth: number;
  parentId: string | null;
}

/**
 * Assign parentId from a depth-first list of items with known depth.
 * The parent of an item is the nearest preceding item with depth-1.
 */
export function computeParents<T extends DepthItem>(items: T[]): T[] {
  const stack: T[] = [];
  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }
    const parent =
      stack.length > 0 && stack[stack.length - 1].depth === item.depth - 1
        ? stack[stack.length - 1].id
        : null;
    item.parentId = parent;
    stack.push(item);
  }
  return items;
}

/* ------------------------- discussion item detection ----------------------- */

const COMMENT_ROOT_SEL = '[data-testid*="comment" i], [class*="comment" i]';
const COMMENT_TEXT_SEL = ".md, .text, .body, .comment-body, .comment-text, p";
const COMMENT_AUTHOR_SEL =
  '.author, .username, [data-testid*="author" i], [data-author]';
const COMMENT_SCORE_SEL =
  ".score, .votes, .points, [data-testid*=\"score\" i], [data-score]";

function parseScore(raw: string | null | undefined): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^0-9-]/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

const DELETED_RE = /^\[?(deleted|removed|comment deleted)\]?$/i;

/**
 * Best-effort detection of comment blocks in a generic page. Looks for elements
 * whose class or data-testid signals a comment, then pulls author / score /
 * permalink / depth. Containers that wrap other comment candidates are skipped
 * so we don't double-collect. Returns real discussion items (including deleted
 * ones, flagged) for clustering and source grounding.
 */
export function extractDiscussionItems(doc: Document): DiscussionItem[] {
  const roots = Array.from(doc.querySelectorAll<HTMLElement>(COMMENT_ROOT_SEL));
  const items: DiscussionItem[] = [];
  let n = 0;
  for (const el of roots) {
    // Skip wrappers (e.g. .comment-list) that contain nested comment candidates.
    if (el.querySelector(COMMENT_ROOT_SEL)) continue;
    const textEl = el.querySelector(COMMENT_TEXT_SEL);
    const text = cleanText(textEl?.textContent ?? el.textContent ?? "");
    if (text.length < 5) continue;

    const authorEl = el.querySelector(COMMENT_AUTHOR_SEL);
    const author = authorEl?.textContent?.trim() ?? null;
    const score = parseScore(el.querySelector(COMMENT_SCORE_SEL)?.textContent);
    const link = el.querySelector<HTMLAnchorElement>("a[href]");
    const permalink = link?.getAttribute("href") ?? null;
    const depthRaw = el.getAttribute("data-depth");
    const depth =
      depthRaw != null && /^\d+$/.test(depthRaw) ? parseInt(depthRaw, 10) : 0;
    const deleted = DELETED_RE.test(text);

    const id = `comment-${++n}`;
    el.setAttribute(SIGNAL_ATTR, id);
    items.push({
      id,
      parentId: null,
      author,
      text,
      score,
      depth,
      permalink,
      position: items.length + 1,
      deleted,
    });
  }
  return items;
}
