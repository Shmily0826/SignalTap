/** DOM helpers shared by the extraction adapters. */

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
