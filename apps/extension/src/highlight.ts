import type { Adapter, HighlightResult } from "./adapters/types";
import { SIGNAL_ATTR } from "./adapters/dom";

const HIGHLIGHT_CSS = `
.sigsoil-highlighted {
  outline: 3px solid #4f8cff !important;
  outline-offset: 2px !important;
  border-radius: 3px !important;
  transition: outline-color 0.2s ease;
}
.sigsoil-highlighted--dimmed { outline-color: #2ecc71 !important; }
.sigsoil-label {
  position: absolute;
  z-index: 2147483647;
  background: #4f8cff;
  color: #fff;
  font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif;
  padding: 2px 7px;
  border-radius: 999px;
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0,0,0,.35);
  top: -20px;
  left: 4px;
  white-space: nowrap;
}
/* Label text is rendered via a pseudo-element so it is NOT part of the
   element's textContent. This keeps re-extraction (cache hits, profile
   switches) from picking up the "SignalTap source" string. */
.sigsoil-label::before { content: attr(data-label); }
`;

let styleInjected = false;
function ensureStyles(doc: Document) {
  if (styleInjected || doc.getElementById("sigsoil-styles")) return;
  const style = doc.createElement("style");
  style.id = "sigsoil-styles";
  style.textContent = HIGHLIGHT_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  styleInjected = true;
}

let current: { el: Element; label: HTMLElement | null } | null = null;

export function findSourceElement(
  sourceId: string,
  adapter: Adapter | null,
  doc: Document
): Element | null {
  const viaAdapter = adapter?.getSourceElement(sourceId, doc);
  if (viaAdapter) return viaAdapter;
  try {
    return doc.querySelector(`[${SIGNAL_ATTR}="${CSS.escape(sourceId)}"]`);
  } catch {
    return null;
  }
}

export function highlightSource(
  sourceId: string,
  adapter: Adapter | null,
  doc: Document
): HighlightResult {
  clearHighlights();
  ensureStyles(doc);
  const el = findSourceElement(sourceId, adapter, doc);
  if (!el) return { found: false };

  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("sigsoil-highlighted");

  const label = doc.createElement("span");
  label.className = "sigsoil-label";
  label.setAttribute("data-label", "SignalTap source");
  label.setAttribute("role", "status");
  el.setAttribute("data-sigsoil-labelled", "true");
  el.appendChild(label);
  current = { el, label };

  return { found: true };
}

export function clearHighlights() {
  if (!current) return;
  current.el.classList.remove("sigsoil-highlighted");
  current.el.removeAttribute("data-sigsoil-labelled");
  current.label?.remove();
  current = null;
}
