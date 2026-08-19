import { ExtractedContent, MainContentItem } from "@signaltap/schemas";
import { Adapter } from "./types";
import {
  SIGNAL_ATTR,
  cleanText,
  hostname,
  isVisible,
  metaContent,
} from "./dom";

const ADAPTER_ID = "YouTubeAdapter";
const ADAPTER_VERSION = "1.0.0";

export const YouTubeAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  supports(url) {
    const host = hostname(url);
    return (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be"
    );
  },

  extract(doc, url) {
    const title =
      metaContent(doc, 'meta[property="og:title"]') ??
      doc.querySelector("h1")?.textContent?.trim() ??
      doc.title ??
      null;
    const author =
      doc.querySelector("ytd-channel-name a")?.textContent?.trim() ??
      metaContent(doc, 'meta[name="author"]') ??
      null;
    const publishedAt = metaContent(doc, 'meta[itemprop="datePublished"]');

    const mainContent: MainContentItem[] = [];
    let n = 0;

    // Transcript segments (only available when the user opened the transcript panel).
    const transcript = doc.querySelector("ytd-transcript-renderer");
    if (transcript) {
      const segments = transcript.querySelectorAll(
        "ytd-transcript-segment-renderer"
      );
      for (const seg of segments) {
        if (!isVisible(seg)) continue;
        const ts = seg.querySelector(".yt-transcript-segment-timestamp")?.textContent?.trim();
        const text = seg.querySelector('yt-formatted-string[slot="text"]')?.textContent?.trim();
        if (!text) continue;
        const id = `timestamp-${++n}`;
        seg.setAttribute(SIGNAL_ATTR, id);
        mainContent.push({
          id,
          text: ts ? `[${ts}] ${cleanText(text)}` : cleanText(text),
          headingPath: ["Transcript"],
          position: n,
        });
      }
      return {
        schemaVersion: "1.0",
        adapter: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
        pageType: "video",
        url,
        canonicalUrl: url,
        title,
        author,
        publishedAt,
        mainContent,
        discussionItems: [],
        captureScope: "transcript",
        extractionWarnings: [],
      };
    }

    // No transcript: fall back to description.
    const descEl = doc.querySelector("ytd-watch-metadata #description");
    const desc = cleanText(descEl?.textContent ?? "");
    if (desc) {
      const id = `paragraph-${++n}`;
      descEl!.setAttribute(SIGNAL_ATTR, id);
      mainContent.push({
        id,
        text: desc.slice(0, 6000),
        headingPath: ["Description"],
        position: n,
      });
    }

    return {
      schemaVersion: "1.0",
      adapter: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      pageType: "video",
      url,
      canonicalUrl: url,
      title,
      author,
      publishedAt,
      mainContent,
      discussionItems: [],
      captureScope: "loaded_content",
      extractionWarnings: [
        {
          code: "transcript_not_available",
          message:
            "Transcript not detected on this page. Only the video description was captured. Open the transcript panel and retry for full-video analysis.",
        },
      ],
    };
  },

  getSourceElement(sourceId, doc) {
    return doc.querySelector(`[${SIGNAL_ATTR}="${CSS.escape(sourceId)}"]`);
  },
};
