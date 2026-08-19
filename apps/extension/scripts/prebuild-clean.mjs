// Pre-build/test cleanup for the extension workspace.
//
// On this dev machine the "safe-delete" shim wraps Node's fs removal and throws
// AFTER the removal already succeeded. That makes tools that remove directories
// through Node's fs (Vite emptyOutDir, Playwright's test-results cleanup,
// Playwright's __dirlock) abort with a spurious error. Cleaning the directories
// here first — ignoring the error — lets those tools start from a clean slate.
import { existsSync, rmSync } from "fs";

const targets = ["dist", "test-results", "playwright-report"];

for (const dir of targets) {
  if (!existsSync(dir)) continue;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* removal still succeeded; shim threw afterwards */
  }
}

// Verify; retry once if something survived.
for (const dir of targets) {
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const remaining = targets.filter((d) => existsSync(d));
if (remaining.length > 0) {
  console.warn(
    `[prebuild-clean] still present after cleanup: ${remaining.join(", ")}`
  );
} else {
  console.log("[prebuild-clean] dist/test-results/playwright-report cleaned");
}
