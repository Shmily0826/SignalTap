/**
 * SignalTap content script.
 *
 * Injected into the active tab (activeTab permission model). Provides:
 *  - a message API for the side panel (EXTRACT / HIGHLIGHT / CLEAR_HIGHLIGHTS)
 *  - an in-page floating action button
 *  - an in-page panel fallback when the side panel API is unavailable
 */

import { ADAPTERS, selectAdapter } from "./adapters";
import type { Adapter } from "./adapters/types";
import {
  clearHighlights as clearAll,
  highlightSource as doHighlight,
} from "./highlight";
import type { ExtractedContent } from "@signaltap/schemas";

declare global {
  interface Window {
    __sigsoil_installed?: boolean;
  }
}

const API_BASE = "http://localhost:8787";
let activeAdapter: Adapter | null = null;
let lastExtracted: ExtractedContent | null = null;

if (!window.__sigsoil_installed) {
  window.__sigsoil_installed = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "PING":
        sendResponse({ ok: true });
        break;
      case "EXTRACT": {
        try {
          const adapter = selectAdapter(location.href, document);
          activeAdapter = adapter;
          lastExtracted = adapter.extract(document, location.href);
          sendResponse({
            ok: true,
            extracted: lastExtracted,
            adapterId: adapter.id,
            adapterVersion: adapter.version,
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }
      case "HIGHLIGHT": {
        const res = doHighlight(msg.sourceId, activeAdapter, document);
        const excerpt =
          !res.found && lastExtracted
            ? findExcerpt(lastExtracted, msg.sourceId)
            : undefined;
        sendResponse({ ...res, excerpt });
        break;
      }
      case "CLEAR_HIGHLIGHTS":
        clearAll();
        sendResponse({ ok: true });
        break;
      default:
        return false;
    }
    return true;
  });

  injectFab();

  // Keep injection idempotent on the same page.
  window.addEventListener("beforeunload", () => {
    window.__sigsoil_installed = false;
  });
}

function findExcerpt(extracted: ExtractedContent, sourceId: string): string | undefined {
  for (const item of extracted.mainContent) {
    if (item.id === sourceId) return item.text;
  }
  for (const item of extracted.discussionItems) {
    if (item.id === sourceId) return item.text;
  }
  return undefined;
}

/* ------------------------------ floating button ---------------------------- */

function injectFab() {
  if (document.getElementById("sigsoil-fab")) return;
  const fab = document.createElement("button");
  fab.id = "sigsoil-fab";
  fab.setAttribute("aria-label", "SignalTap - analyze this page");
  fab.textContent = "⛉";
  fab.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483646",
    "width:48px",
    "height:48px",
    "border-radius:999px",
    "background:#4f8cff",
    "color:#fff",
    "font-size:20px",
    "border:none",
    "cursor:pointer",
    "box-shadow:0 4px 14px rgba(0,0,0,.35)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
  ].join(";");
  fab.title = "SignalTap - analyze this page";
  fab.onclick = async () => {
    fab.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
      if (!resp?.ok) throw new Error("side panel unavailable");
    } catch {
      openInlinePanel();
    } finally {
      fab.disabled = false;
    }
  };
  document.documentElement.appendChild(fab);
}

/* --------------------------- in-page panel fallback ------------------------ */

function injectPanelStyle() {
  if (document.getElementById("sigsoil-panel-style")) return;
  const style = document.createElement("style");
  style.id = "sigsoil-panel-style";
  style.textContent = `
    #sigsoil-panel { position:fixed; top:16px; right:16px; width:380px; max-width:92vw;
      max-height:82vh; overflow-y:auto; z-index:2147483646; background:#11161d; color:#e5e9ef;
      border:1px solid #232b36; border-radius:12px; font:14px/1.5 ui-sans-serif,system-ui,sans-serif;
      box-shadow:0 8px 30px rgba(0,0,0,.5); padding:14px 16px; }
    #sigsoil-panel h3 { margin:0 0 6px; font-size:15px; }
    #sigsoil-panel .sig-note { color:#8b96a5; font-size:12px; margin:0 0 10px; }
    #sigsoil-panel .sig-sec { margin:10px 0; }
    #sigsoil-panel .sig-sec > b { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#8b96a5; }
    #sigsoil-panel ul { margin:4px 0; padding-left:18px; }
    #sigsoil-panel li { margin:2px 0; }
    #sigsoil-panel .sig-src { color:#4f8cff; text-decoration:underline dotted; cursor:pointer; }
    #sigsoil-panel .sig-btn { background:#232b36; color:#e5e9ef; border:1px solid #39424f; border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; }
    #sigsoil-panel .sig-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    #sigsoil-panel .sig-score { font-size:28px; font-weight:700; color:#4f8cff; }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

function openInlinePanel() {
  injectPanelStyle();
  if (document.getElementById("sigsoil-panel")) return;
  const panel = document.createElement("div");
  panel.id = "sigsoil-panel";
  document.documentElement.appendChild(panel);

  const close = () => {
    panel.remove();
    window.__sigsoil_installed = true;
  };

  panel.innerHTML = `
    <div class="sig-row">
      <h3>SignalTap</h3>
      <button class="sig-btn" data-action="close">✕</button>
    </div>
    <p class="sig-note">Side panel unavailable - showing in-page analysis.</p>
    <div data-role="body">Extracting page…</div>`;

  panel.querySelector('[data-action="close"]')!.addEventListener("click", close);

  runInlineAnalysis(panel);
}

async function runInlineAnalysis(panel: HTMLElement) {
  const body = panel.querySelector<HTMLElement>("[data-role='body']")!;
  let controller: AbortController | null = null;

  try {
    const adapter = selectAdapter(location.href, document);
    activeAdapter = adapter;
    const extracted = adapter.extract(document, location.href);
    lastExtracted = extracted;
    body.textContent = "Organizing content…";

    controller = new AbortController();
    const res = await fetch(`${API_BASE}/v1/analysis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "1.0",
        url: location.href,
        canonicalUrl: extracted.canonicalUrl,
        title: extracted.title,
        profile: "general",
        extracted,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = await res.json();
    const result = data.result;

    body.innerHTML = "";
    const score = result.verdict.worthAttention;

    const src = (sourceId: string) => {
      const span = document.createElement("span");
      span.className = "sig-src";
      span.textContent = "source";
      span.onclick = () => {
        const r = doHighlight(sourceId, activeAdapter, document);
        if (!r.found) alert("This source is no longer on the page.");
      };
      return span;
    };

    const h = document.createElement("div");
    h.innerHTML = `
      <div class="sig-row"><div class="sig-score">${score}/10</div>
        <button class="sig-btn" data-action="close">✕</button></div>
      <p class="sig-note">${escapeHtml(result.verdict.reason)} · confidence ${Math.round(result.verdict.confidence * 100)}%</p>
      <div class="sig-sec"><b>Signal</b><p style="margin:4px 0">${escapeHtml(result.summary)}</p></div>
      <div class="sig-sec"><b>Key facts</b><ul>${result.keyFacts
        .map((f: string) => `<li>${escapeHtml(f)}</li>`)
        .join("")}</ul></div>
      <div class="sig-sec"><b>Consensus</b><ul>${result.consensus
        .map((c: string) => `<li>${escapeHtml(c)}</li>`)
        .join("")}</ul></div>
      <div class="sig-sec"><b>Disagreement</b><ul>${result.disagreements
        .map((c: string) => `<li>${escapeHtml(c)}</li>`)
        .join("")}</ul></div>`;
    body.appendChild(h);

    // Rebind close button inside the new content.
    body.querySelector('[data-action="close"]')?.addEventListener("click", () => panel.remove());

    // Attach source links.
    for (const ref of result.sourceReferences ?? []) {
      const row = document.createElement("div");
      row.style.cssText = "margin:6px 0;font-size:12px;color:#8b96a5";
      row.textContent = `“${ref.excerpt.slice(0, 90)}…” `;
      row.appendChild(src(ref.sourceId));
      body.appendChild(row);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    body.textContent = `Analysis failed: ${msg}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

// Referenced to keep the bundle tree-shaking-friendly.
export const __adapters__ = ADAPTERS;
