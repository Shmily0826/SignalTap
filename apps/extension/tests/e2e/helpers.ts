import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "path";

/**
 * Launch Chromium with the built extension loaded (persistent context so
 * chrome-extension:// pages and the service worker work).
 *
 * Note: extensions require a headed browser, and MV3 service workers start
 * lazily — the 'serviceworker' event may never fire for a dormant worker,
 * so we poll the worker list instead of waiting for the event.
 */
export async function launchWithExtension(): Promise<{
  context: BrowserContext;
  extId: string;
}> {
  const extPath = path.resolve("dist");
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ],
  });

  let extId = "";
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const sw = context.serviceWorkers()[0];
    if (sw) {
      extId = new URL(sw.url()).host;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(extId).not.toBe("");
  return { context, extId };
}

/** Find the tab id of the page showing the given URL (via the SW). */
export async function tabIdOf(
  context: BrowserContext,
  urlPrefix: string
): Promise<number> {
  const sw = context.serviceWorkers()[0]!;
  return sw.evaluate(async (prefix) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url?.startsWith(prefix));
    return tab?.id ?? -1;
  }, urlPrefix);
}

export async function openPanel(
  context: BrowserContext,
  extId: string,
  tabId: number
) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  return panel;
}
