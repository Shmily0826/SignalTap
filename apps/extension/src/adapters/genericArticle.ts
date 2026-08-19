import {
  CaptureScope,
  ExtractedContent,
  MainContentItem,
} from "@signaltap/schemas";
import { Adapter } from "./types";
import {
  SIGNAL_ATTR,
  canonicalUrl,
  cleanText,
  isNoise,
  isVisible,
  metaContent,
  paywallHint,
} from "./dom";

const ADAPTER_ID = "GenericArticleAdapter";
const ADAPTER_VERSION = "1.0.0";

function findMainContainer(doc: Document): Element | null {
  const article = doc.querySelector("article");
  if (article) return article;
  const main = doc.querySelector("main");
  if (main) return main;
  // Largest paragraph cluster heuristic (readability-style fallback).
  let best: Element | null = null;
  let bestLen = 0;
  for (const div of doc.querySelectorAll<HTMLElement>("div")) {
    if (isNoise(div) || !isVisible(div)) continue;
    let len = 0;
    for (const p of div.querySelectorAll("p")) len += p.textContent?.length ?? 0;
    if (len > bestLen) {
      bestLen = len;
      best = div;
    }
  }
  return bestLen > 400 ? best : null;
}

export const GenericArticleAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  supports(_url, doc) {
    if (doc.querySelector("article") || doc.querySelector("main")) return true;
    if (metaContent(doc, 'meta[property="og:type"]') === "article") return true;
    let paragraphs = 0;
    for (const p of doc.querySelectorAll("p")) {
      if (!isNoise(p) && isVisible(p) && (p.textContent ?? "").trim().length > 40) {
        paragraphs++;
        if (paragraphs >= 3) return true;
      }
    }
    return false;
  },

  extract(doc, url) {
    const container = findMainContainer(doc);
    const mainContent: MainContentItem[] = [];
    const headingPath: string[] = [];
    let pCount = 0;
    let hCount = 0;

    if (container) {
      const walker = container.querySelectorAll<HTMLElement>(
        "p, h1, h2, h3, h4, h5, h6, li"
      );
      for (const el of walker) {
        if (isNoise(el) || !isVisible(el)) continue;
        const text = cleanText(el.textContent ?? "");
        if (!text || text.length < 2) continue;
        const tag = el.tagName.toLowerCase();

        if (tag === "h1" || tag === "h2" || tag === "h3") {
          // Track heading hierarchy for headingPath.
          const level = Number(tag[1]);
          while (headingPath.length > 0 && headingPath.length >= level) {
            headingPath.pop();
          }
          headingPath.push(text.slice(0, 120));
          const id = `heading-${++hCount}`;
          el.setAttribute(SIGNAL_ATTR, id);
          mainContent.push({
            id,
            text,
            headingPath: [...headingPath],
            position: mainContent.length + 1,
          });
          continue;
        }

        const id = `paragraph-${++pCount}`;
        el.setAttribute(SIGNAL_ATTR, id);
        mainContent.push({
          id,
          text,
          headingPath: headingPath.length ? [...headingPath] : undefined,
          position: mainContent.length + 1,
        });
      }
    }

    const fullPage = Boolean(
      container && (doc.querySelector("article") || doc.querySelector("main"))
    );
    const captureScope: CaptureScope = fullPage ? "full_page" : "loaded_content";
    const warnings: { code: string; message: string }[] = [];

    const joined = mainContent.map((m) => m.text).join(" ");
    if (mainContent.length < 3) {
      warnings.push({
        code: "possibly_incomplete",
        message: "Very little article content was detected; the article may be incomplete or paywalled.",
      });
    }
    if (paywallHint(joined)) {
      warnings.push({
        code: "paywall_detected",
        message: "Paywall or sign-in language detected; the full article may not be captured.",
      });
    }

    const title =
      metaContent(doc, 'meta[property="og:title"]', 'meta[name="twitter:title"]') ??
      doc.title ??
      null;
    const author =
      metaContent(doc, 'meta[name="author"]', 'meta[property="article:author"]') ??
      doc.querySelector('[rel="author"]')?.textContent?.trim() ??
      null;
    const publishedAt =
      metaContent(doc, 'meta[property="article:published_time"]') ??
      doc.querySelector("time")?.getAttribute("datetime") ??
      null;

    const extracted: ExtractedContent = {
      schemaVersion: "1.0",
      adapter: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      pageType: "article",
      url,
      canonicalUrl: canonicalUrl(doc, url),
      title,
      author,
      publishedAt,
      mainContent,
      discussionItems: [],
      captureScope,
      extractionWarnings: warnings,
    };
    return extracted;
  },

  getSourceElement(sourceId, doc) {
    return doc.querySelector(`[${SIGNAL_ATTR}="${CSS.escape(sourceId)}"]`);
  },
};
