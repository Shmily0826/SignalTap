import { ExtractedContent } from "@signaltap/schemas";

export interface Adapter {
  readonly id: string;
  readonly version: string;
  supports(url: string, doc: Document): boolean;
  extract(doc: Document, url: string): ExtractedContent;
  /** Resolve a sourceId (e.g. "paragraph-3", "comment-5") back to its DOM element. */
  getSourceElement(sourceId: string, doc: Document): Element | null;
}

export interface HighlightResult {
  found: boolean;
  /** Present when the element no longer exists; fallback excerpt for the UI. */
  excerpt?: string;
}
