import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * The shipped manifest uses only `activeTab` (privacy-first): the content
 * extractor is injected on a real toolbar click, which grants `activeTab` for
 * that tab. Playwright can't click the toolbar, so for the e2e build we add a
 * localhost-only `host_permissions` entry to `dist/manifest.json` — just enough
 * for the test fixtures. The committed `public/manifest.json` is untouched.
 */
function patchHostPermissionForTests(extPath: string) {
  const manifestPath = path.join(extPath, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const extra = ["http://localhost/*", "http://127.0.0.1/*", "https://localhost/*"];
  const existing: string[] = manifest.host_permissions ?? [];
  manifest.host_permissions = Array.from(new Set([...existing, ...extra]));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest.host_permissions;
}

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
  patchHostPermissionForTests(extPath);
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

/** Wait for (or re-acquire) the extension's service worker. */
async function activeSW(context: BrowserContext) {
  let sw = context.serviceWorkers()[0];
  const deadline = Date.now() + 10_000;
  while (!sw && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    sw = context.serviceWorkers()[0];
  }
  return sw!;
}

/**
 * Get the id of the currently active tab.
 *
 * SignalTap intentionally requests only `activeTab` (no `tabs` permission) to
 * minimise what it can read across the browser. Without the `tabs` permission,
 * `tab.url` is hidden for non-active / cross-origin pages, so we must NOT match
 * on the URL. `tab.id` is always readable, and the active tab is the fixture
 * page we just navigated to, so we read that id directly.
 */
export async function tabIdOf(context: BrowserContext): Promise<number> {
  const sw = await activeSW(context);
  return sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? -1;
  });
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
