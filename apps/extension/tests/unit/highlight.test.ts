import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import {
  clearHighlights,
  findSourceElement,
  highlightSource,
} from "../../src/highlight";

// The highlight engine uses the browser's CSS.escape global, which does not
// exist in the plain-node vitest environment. Polyfill it for these tests.
if (!(globalThis as any).CSS) {
  (globalThis as any).CSS = {
    escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  };
}

/**
 * Regression suite for the click-to-source highlight engine.
 *
 * Historical bug: an early implementation rendered the "SignalTap source"
 * label as real text inside the highlighted element, which polluted
 * textContent and changed extraction fingerprints (cache misses). The label
 * is now a pseudo-element; these tests lock that in.
 */

function makeDoc() {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <article>
        <p data-sigsoil-id="paragraph-1">The study found 61% of developers prefer offline tools.</p>
        <p data-sigsoil-id="paragraph-2">Local-first apps sync locally first, the cloud is a mirror.</p>
      </article>
    </body></html>`
  );
  // JSDOM does not implement scrollIntoView.
  (dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
  return dom.window.document;
}

beforeEach(() => {
  clearHighlights();
});

describe("findSourceElement", () => {
  it("locates elements by the stable source id attribute", () => {
    const doc = makeDoc();
    const el = findSourceElement("paragraph-2", null, doc);
    expect(el?.getAttribute("data-sigsoil-id")).toBe("paragraph-2");
  });

  it("returns null for unknown ids instead of throwing", () => {
    const doc = makeDoc();
    expect(findSourceElement("does-not-exist", null, doc)).toBeNull();
  });
});

describe("highlightSource", () => {
  it("highlights the target element and reports found", () => {
    const doc = makeDoc();
    const result = highlightSource("paragraph-1", null, doc);
    expect(result.found).toBe(true);
    const el = doc.querySelector('[data-sigsoil-id="paragraph-1"]')!;
    expect(el.classList.contains("sigsoil-highlighted")).toBe(true);
    expect(el.getAttribute("data-sigsoil-labelled")).toBe("true");
  });

  it("reports not found for unknown ids", () => {
    const doc = makeDoc();
    expect(highlightSource("fake-999", null, doc)).toEqual({ found: false });
  });

  it("NEVER changes the highlighted element's textContent (cache-fingerprint regression)", () => {
    const doc = makeDoc();
    const el = doc.querySelector('[data-sigsoil-id="paragraph-1"]')!;
    const before = el.textContent;
    const articleBefore = doc.querySelector("article")!.textContent;

    highlightSource("paragraph-1", null, doc);

    // Label text must live in a pseudo-element (attr-driven), not in the DOM text.
    expect(el.textContent).toBe(before);
    expect(doc.querySelector("article")!.textContent).toBe(articleBefore);
    const label = el.querySelector(".sigsoil-label")!;
    expect(label.getAttribute("data-label")).toBe("SignalTap source");
    expect(label.textContent).toBe("");
  });

  it("the label is not picked up as a new paragraph by re-extraction selectors", () => {
    const doc = makeDoc();
    highlightSource("paragraph-1", null, doc);
    // The label span carries no sigsoil id and no text, so a re-scan of the
    // same document must still see exactly the two original paragraphs.
    const annotated = doc.querySelectorAll("[data-sigsoil-id]");
    expect(annotated.length).toBe(2);
  });
});

describe("clearHighlights", () => {
  it("removes the highlight class, label and marker attribute", () => {
    const doc = makeDoc();
    highlightSource("paragraph-1", null, doc);
    const el = doc.querySelector('[data-sigsoil-id="paragraph-1"]')!;

    clearHighlights();

    expect(el.classList.contains("sigsoil-highlighted")).toBe(false);
    expect(el.hasAttribute("data-sigsoil-labelled")).toBe(false);
    expect(el.querySelector(".sigsoil-label")).toBeNull();
    expect(el.textContent).toBe("The study found 61% of developers prefer offline tools.");
  });

  it("is a no-op when nothing is highlighted", () => {
    expect(() => clearHighlights()).not.toThrow();
  });

  it("re-highlighting moves the highlight to the new target", () => {
    const doc = makeDoc();
    highlightSource("paragraph-1", null, doc);
    highlightSource("paragraph-2", null, doc);

    const p1 = doc.querySelector('[data-sigsoil-id="paragraph-1"]')!;
    const p2 = doc.querySelector('[data-sigsoil-id="paragraph-2"]')!;
    expect(p1.classList.contains("sigsoil-highlighted")).toBe(false);
    expect(p1.querySelector(".sigsoil-label")).toBeNull();
    expect(p2.classList.contains("sigsoil-highlighted")).toBe(true);
    expect(p2.querySelector(".sigsoil-label")).not.toBeNull();
  });
});
