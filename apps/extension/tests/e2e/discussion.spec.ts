import { test, expect } from "@playwright/test";
import { launchWithExtension, tabIdOf, openPanel } from "./helpers";

/**
 * Discussion fixture (nested comments): extraction is limited to loaded
 * comments, consensus/disagreement are derived from clusters, and the UI
 * discloses the capture scope.
 */
test("discussion loop: nested comments, consensus & disagreement, scope disclosure", async () => {
  const { context, extId } = await launchWithExtension();

  try {
    const page = await context.newPage();
    await page.goto("http://localhost:8099/discussion.html");
    const tabId = await tabIdOf(context);
    expect(tabId).toBeGreaterThan(0);

    const panel = await openPanel(context, extId, tabId);

    // Capture scope badge says "Loaded content".
    await expect(panel.locator("text=Loaded content").first()).toBeVisible({
      timeout: 30000,
    });

    // Analysis completes with a score.
    await expect(panel.locator(".text-2xl.font-bold").first()).toBeVisible({
      timeout: 30000,
    });

    // Consensus and disagreement sections appear (from clustering).
    await expect(panel.locator(".st-section-title", { hasText: "Consensus" })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      panel.locator(".st-section-title", { hasText: "Disagreement" })
    ).toBeVisible({ timeout: 30000 });

    // Limitation is disclosed: only loaded comments are analyzed.
    await expect(
      panel.locator("text=/loaded comments/").first()
    ).toBeVisible({ timeout: 30000 });

    // Best comments section offers clickable source chips.
    const bestChips = panel.locator(".st-section-title", { hasText: "Best comments" });
    await expect(bestChips.first()).toBeVisible({ timeout: 30000 });

    // Click a comment source -> the nested comment element highlights.
    const chip = panel.getByRole("button", { name: /^#comment-/ }).first();
    await chip.click();
    await page.waitForTimeout(600);
    const highlighted = await page.evaluate(
      () => document.querySelectorAll(".sigsoil-highlighted").length
    );
    expect(highlighted).toBeGreaterThanOrEqual(1);

    await panel.close();
  } finally {
    await context.close();
  }
});
