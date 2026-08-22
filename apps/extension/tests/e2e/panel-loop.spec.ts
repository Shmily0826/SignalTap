import { test, expect } from "@playwright/test";
import { launchWithExtension, tabIdOf, openPanel } from "./helpers";

/**
 * UI closed-loop verification (feedback / history / profile / delete):
 * - the ▲ feedback button actually reaches the backend and is recorded;
 * - history lists the analysis with its score and reopens the cached result;
 * - switching the relevance profile in settings triggers a fresh analysis
 *   under a new cache key (two history entries);
 * - delete removes the current entry; "Clear all local results" empties history.
 */
test("panel loop: feedback recorded on backend, history reopens cached, profile switch re-analyzes, delete clears", async () => {
  const { context, extId } = await launchWithExtension();

  try {
    const page = await context.newPage();
    await page.goto("http://localhost:8099/article.html");
    const tabId = await tabIdOf(context);
    expect(tabId).toBeGreaterThan(0);

    const panel = await openPanel(context, extId, tabId);
    const score = panel.locator(".text-2xl.font-bold").first();
    await expect(score).toBeVisible({ timeout: 30000 });

    // --- 1) Feedback: the ▲ button must reach the backend, not just show UI.
    const feedbackCount = async () =>
      panel.evaluate(async () => {
        const r = await fetch("http://localhost:8787/v1/feedback");
        const j = await r.json();
        return j.count as number;
      });
    const before = await feedbackCount();
    await panel.getByRole("button", { name: "▲" }).click();
    await expect(panel.locator("text=Thanks for the feedback")).toBeVisible();
    expect(await feedbackCount()).toBe(before + 1);

    // --- 2) History: entry shows title + score, clicking reopens the result.
    await panel.locator('button[title="History"]').click();
    const entry = panel.locator(".st-card button", { hasText: "Why local-first software" });
    await expect(entry).toBeVisible({ timeout: 10000 });
    await expect(entry.locator("text=/score \\d+\\.\\d/")).toBeVisible();
    await entry.first().click();
    await expect(score).toBeVisible({ timeout: 10000 });
    await expect(panel.locator("text=Cached result for this page.")).toBeVisible();

    // --- 3) Profile switch: new weights applied, analysis re-runs under a new
    //        cache key (profile is part of the key), producing a second entry.
    await panel.locator('button[title="Settings"]').click();
    await panel.locator("select").selectOption("researcher");
    // Footer reflects the persisted setting.
    await expect(panel.locator("text=profile: Researcher")).toBeVisible({ timeout: 10000 });
    // The re-run lands in history next to the general-profile entry.
    await panel.locator('button[title="History"]').click();
    const entries = panel.locator(".st-card button", { hasText: "Why local-first software" });
    await expect(entries).toHaveCount(2, { timeout: 30000 });
    // Newest first: reopen it and land back on the analysis view.
    await entries.first().click();
    await expect(score).toBeVisible({ timeout: 10000 });

    // --- 4) Delete removes only the current (researcher) entry...
    await panel.getByRole("button", { name: "delete" }).click();
    await expect(panel.locator("text=Analysis deleted.")).toBeVisible();
    await panel.locator('button[title="History"]').click();
    await expect(
      panel.locator(".st-card button", { hasText: "Why local-first software" })
    ).toHaveCount(1, { timeout: 10000 });

    // --- ...and Clear all local results empties history entirely.
    await panel.locator('button[title="Settings"]').click();
    await panel.getByRole("button", { name: "Clear all local results" }).click();
    await expect(panel.locator("text=Local history cleared.")).toBeVisible();
    await panel.locator('button[title="History"]').click();
    await expect(
      panel.locator("text=No local analysis history yet.")
    ).toBeVisible({ timeout: 10000 });
    await panel.close();
  } finally {
    await context.close();
  }
});
