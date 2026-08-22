# SignalTap Privacy Policy (draft)

*Last updated: 2026-08-22*

## What SignalTap collects

**Nothing by default beyond your local data.** SignalTap has no analytics, no advertising, and no accounts.

- **On-device storage** (via `chrome.storage.local`): analysis results, history entries, content fingerprints, and your settings (relevance profile, backend URL, retention preferences). All of this stays on your device. You can delete individual results or clear everything in Settings, or disable history entirely.
- **Page content, only after you click**: SignalTap reads the page you are viewing only when you explicitly click the toolbar icon (the `activeTab` permission model). Nothing is read before that click, and nothing is read from any other tab.

## What is sent off-device

When you request an analysis, the extracted and structured text of the current page (not raw HTML) is sent to the SignalTap analysis backend that your settings point to. By default this is `http://localhost:8787` running on your own machine, which uses a deterministic offline provider and sends your data nowhere.

If the backend you use is configured with an AI provider API key (e.g. OpenAI), the extracted content passes through that backend to the model provider for analysis. If you use a backend you don't control, assume the page content and its URL reach that backend's operator and their model provider.

## Server-side retention (self-hosted default backend)

- Analyses are held **in memory only** and disappear on backend restart; `DELETE /v1/analysis/:id` removes one immediately.
- Logs contain **metadata only**: host, page type, block/comment counts, provider name, score, and latency. Page text is never logged.
- Feedback stores rating, issue type, analysis id, host, and comment length — not page content.

## Security choices

- Extracted page content is treated as untrusted data: it is delimited as data in prompts, never as instructions, and model output is validated against a strict schema. Source citations are re-validated against the extracted text; anything that doesn't resolve is dropped and reported.
- The extension never ships API keys; model calls happen backend-side.

## Your controls

Delete a single cached analysis from its card, clear history in Settings, disable history/content retention, or remove the extension (all local data is then removed by Chrome).

## Contact

For questions about this policy, open an issue in the SignalTap repository.
