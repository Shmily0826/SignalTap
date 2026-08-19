import { test, expect } from "@playwright/test";
import { launchWithExtension, tabIdOf, openPanel } from "./helpers";

/**
 * Core product loop over a local article fixture:
 * open page -> click SignalTap -> extract -> side panel -> mock analysis ->
 * click a source -> scroll + highlight -> close & reopen (cached result).
 */
test("article loop: extract, analyze, click-to-source, close & reopen cached", async () => {
  const { context, extId } = await launchWithExtension();

  try {
    const page = await context.newPage();
    await page.goto("http://localhost:8099/article.html");
    const tabId = await tabIdOf(context);
    expect(tabId).toBeGreaterThan(0);

    // 1) Open the side panel page (stand-in for the real side panel UI).
    const panel = await openPanel(context, extId, tabId);

    // 2) Extraction + analysis completes (mock provider).
    await expect(panel.locator("text=Full page")).toBeVisible({ timeout: 30000 });
    await expect(
      panel.locator(".text-2xl.font-bold").first()
    ).toBeVisible({ timeout: 30000 });
    await expect(panel.locator(".st-section-title", { hasText: "Signal" })).toBeVisible({
      timeout: 30000,
    });

    const scoreText = await panel.locator(".text-2xl.font-bold").first().innerText();
    const score = parseFloat(scoreText);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);

    // 3) Click a source chip -> the fixture element gets highlighted.
    const chip = panel.getByRole("button", { name: /^#paragraph-/ }).first();
    await chip.click();
    await page.waitForTimeout(600);
    const highlighted = await page.evaluate(
      () => document.querySelectorAll(".sigsoil-highlighted").length
    );
    expect(highlighted).toBeGreaterThanOrEqual(1);

    // 4) Close and reopen -> cached result shown without a new backend run.
    await panel.close();
    const panel2 = await openPanel(context, extId, tabId);
    await expect(panel2.locator("text=Cached result for this page.")).toBeVisible({
      timeout: 30000,
    });
    await expect(panel2.locator(".text-2xl.font-bold").first()).toBeVisible({
      timeout: 30000,
    });
    await panel2.close();
  } finally {
    await context.close();
  }
});
