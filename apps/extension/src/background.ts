/**
 * SignalTap background service worker (MV3).
 *
 * Responsibilities:
 *  - open the side panel on toolbar click
 *  - inject the content script into the active tab (activeTab permission model)
 *  - forward FAB requests (OPEN_PANEL) from content scripts
 */

const CONTENT_FILE = "content.js";

async function ensureContentInjected(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_FILE],
    });
    return true;
  } catch (e) {
    console.warn("[signaltap] content injection failed", e);
    return false;
  }
}

async function openPanel(tabId: number) {
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (e) {
    console.warn("[signaltap] sidePanel.open failed", e);
  }
}

// Toolbar click = the primary one-tap entry point.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await ensureContentInjected(tab.id);
  await openPanel(tab.id);
  await chrome.storage.session.set({ lastTabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "OPEN_PANEL" || msg?.type === "INJECT_CONTENT") {
    const tabId = msg.tabId ?? sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "no_tab" });
      return;
    }
    (async () => {
      const injected = await ensureContentInjected(tabId);
      if (msg.type === "OPEN_PANEL") await openPanel(tabId);
      sendResponse({ ok: true, injected });
    })();
    return true; // async response
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    // sidePanel API unavailable (e.g. some Chromium builds) - in-page fallback applies.
  }
  await chrome.storage.local.set({ sigsoil_installed_at: Date.now() });
});
