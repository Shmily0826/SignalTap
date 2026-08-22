import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  SIGNAL_ATTR,
  assignId,
  canonicalUrl,
  cleanText,
  computeParents,
  cssEscapeAttr,
  extractDiscussionItems,
  hostname,
  isNoise,
  metaContent,
  paywallHint,
} from "../../src/adapters/dom";

describe("cleanText", () => {
  it("collapses all whitespace runs and trims", () => {
    expect(cleanText("  a \n\t b   c ")).toBe("a b c");
    expect(cleanText("no-change")).toBe("no-change");
  });
});

describe("hostname", () => {
  it("extracts the hostname and returns empty string for invalid URLs", () => {
    expect(hostname("https://news.ycombinator.com/item?id=1")).toBe(
      "news.ycombinator.com"
    );
    expect(hostname("not a url")).toBe("");
  });
});

describe("paywallHint", () => {
  it("detects documented paywall phrases and ignores normal text", () => {
    expect(paywallHint("Subscribe to read the rest of this article")).toBe(true);
    expect(paywallHint("Please log in to continue reading")).toBe(true);
    expect(paywallHint("The study found significant results")).toBe(false);
  });
});

describe("cssEscapeAttr", () => {
  it("escapes backslashes and quotes for attribute selectors", () => {
    expect(cssEscapeAttr('a"b\\c')).toBe('a\\"b\\\\c');
  });
});

describe("computeParents", () => {
  it("assigns parents from a depth-first list using the nearest depth-1 predecessor", () => {
    const items = [
      { id: "a", depth: 0, parentId: null },
      { id: "b", depth: 1, parentId: null },
      { id: "c", depth: 2, parentId: null },
      { id: "d", depth: 1, parentId: null }, // back up: parent is a
      { id: "e", depth: 0, parentId: null }, // new root
    ];
    computeParents(items);
    expect(items.map((i) => [i.id, i.parentId])).toEqual([
      ["a", null],
      ["b", "a"],
      ["c", "b"],
      ["d", "a"],
      ["e", null],
    ]);
  });

  it("returns null parent when depth jumps more than one level", () => {
    const items = [
      { id: "a", depth: 0, parentId: null },
      { id: "b", depth: 3, parentId: null }, // orphan jump
    ];
    computeParents(items);
    expect(items[1].parentId).toBeNull();
  });
});

describe("isNoise / assignId / metaContent / canonicalUrl", () => {
  const dom = new JSDOM(
    `<!doctype html><html><head>
      <meta property="og:title" content="  Shared   title ">
      <link rel="canonical" href="https://example.com/canon">
    </head><body>
      <nav><p id="in-nav">in nav</p></nav>
      <div class="cookie-banner"><p>cookies</p></div>
      <main><p id="clean">real content</p></main>
    </body></html>`
  );
  const doc = dom.window.document;

  it("marks nav/cookie containers as noise but not main content", () => {
    expect(isNoise(doc.getElementById("in-nav")!)).toBe(true);
    expect(isNoise(doc.querySelector(".cookie-banner p")!)).toBe(true);
    expect(isNoise(doc.getElementById("clean")!)).toBe(false);
  });

  it("assignId writes the stable SIGNAL_ATTR attribute", () => {
    const el = doc.getElementById("clean")!;
    const id = assignId(el, "paragraph", 7);
    expect(id).toBe("paragraph-7");
    expect(el.getAttribute(SIGNAL_ATTR)).toBe("paragraph-7");
  });

  it("metaContent cleans and returns meta values, null when missing", () => {
    expect(metaContent(doc, 'meta[property="og:title"]')).toBe("Shared title");
    expect(metaContent(doc, 'meta[property="og:missing"]')).toBeNull();
  });

  it("canonicalUrl prefers link[rel=canonical], then og:url, then fallback", () => {
    expect(canonicalUrl(doc, "https://fallback.example/x")).toBe(
      "https://example.com/canon"
    );
    const dom2 = new JSDOM("<html><head></head><body></body></html>");
    expect(canonicalUrl(dom2.window.document, "https://fallback.example/x")).toBe(
      "https://fallback.example/x"
    );
  });
});

describe("extractDiscussionItems (generic discussion detection)", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div data-testid="comment-list">
      <div class="comment" data-depth="0">
        <span class="author">alice</span>
        <div class="text">Great article about local sync performance</div>
        <span class="score">42</span>
        <a href="/c/1">permalink</a>
      </div>
      <div class="comment" data-depth="1">
        <span class="author">bob</span>
        <div class="text">Agreed, sync is the bottleneck</div>
        <span class="score">7</span>
        <a href="/c/2">permalink</a>
      </div>
      <div class="comment" data-depth="2">
        <div class="text">[removed]</div>
      </div>
    </div>
  </body></html>`);
  const doc = dom.window.document;
  const items = extractDiscussionItems(doc);

  it("captures leaf comment blocks but skips wrapper containers", () => {
    // 3 leaf comments; the comment-list wrapper is skipped
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(["comment-1", "comment-2", "comment-3"]);
  });

  it("extracts author, score, permalink and depth", () => {
    const first = items[0];
    expect(first.author).toBe("alice");
    expect(first.score).toBe(42);
    expect(first.permalink).toBe("/c/1");
    expect(first.depth).toBe(0);
    expect(items[1].depth).toBe(1);
  });

  it("flags removed/deleted text and tolerates missing author", () => {
    const removed = items[2];
    expect(removed.deleted).toBe(true);
    expect(removed.author).toBeNull();
    expect(removed.score).toBe(0);
  });

  it("annotates each captured block with a stable source id", () => {
    expect(doc.querySelector(`[${SIGNAL_ATTR}="comment-2"]`)).not.toBeNull();
  });
});
