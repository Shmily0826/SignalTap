# SignalTap

> **One tap. Just the signal.**

SignalTap is an AI-powered information-judgment layer that analyzes the page you are **already viewing** — no copying, no pasting, no tab-switching. It tells you what the content is actually saying, whether it's worth your time, what's fact vs. opinion vs. speculation, and where people agree and disagree — with every conclusion linked back to the original source passage.

This is the **desktop MVP** (Phase A): a Chrome/Edge Manifest V3 extension with an activeTab permission model, a page-extractor adapter system, a side panel, a minimal backend API, deterministic mock analysis by default, and an optional real LLM provider.

---

## 1. Architecture summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome / Edge                             │
│  ┌──────────────┐      ┌──────────────────────────────────┐     │
│  │  background  │      │  side panel (React + Tailwind)   │     │
│  │  (SW, MV3)   │◄────►│  verdict · facts · consensus ·   │     │
│  │  open panel, │      │  click-to-source · history ·     │     │
│  │  inject page │      │  settings · feedback             │     │
│  └──────┬───────┘      └───────────────┬──────────────────┘     │
│         │                              │ chrome.tabs messages    │
│  ┌──────▼──────────────────────────────▼──────────────────┐     │
│  │ content script (injected on click, activeTab model)     │     │
│  │  adapters: article · reddit · hn · github · youtube ·   │     │
│  │  generic   → structured, source-ID-annotated extraction │     │
│  │  click-to-highlight engine · FAB · in-page fallback     │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS (no raw content logged)
┌──────────────────────────────▼──────────────────────────────────┐
│  Backend API (Hono, Node or Cloudflare-compatible)              │
│   POST /v1/analysis · GET|DELETE /v1/analysis/:id ·             │
│   POST /v1/feedback · rate-limit · size limits · sanitize       │
│   ┌──────────────────────┐   ┌──────────────────────────┐       │
│   │  MockAnalysisProvider│   │  OpenAIProvider (opt-in) │       │
│   │  deterministic, free │   │  structured JSON + Zod   │       │
│   │  (default)           │   │  retry · timeout ·       │       │
│   └──────────────────────┘   │  fallback→mock on error  │       │
│                              └──────────────────────────┘       │
│   scoring: explicit dimensions + profile weights (never LLM-invented)│
└──────────────────────────────────────────────────────────────────┘
```

Design decisions worth knowing:

- **No blanket host permissions.** The extension asks for `activeTab` and injects its extractor only when you click the toolbar icon. Nothing is read before your click.
- **Extraction is structured, not DOM dumps.** Adapters normalize pages into a shared Zod-validated schema (`@signaltap/schemas`) with stable per-paragraph / per-comment source IDs, then annotate the live DOM so any conclusion can scroll back to its evidence.
- **No raw content sent to the LLM.** Extraction truncates and sanitizes; the backend validates payloads and never logs page text.
- **The score is computed, not invented.** The model (or mock) only rates 8 explicit dimensions; `calculateWorthAttention` combines them with documented per-profile weights. The UI labels it a *content-prioritization aid*, not objective truth.
- **Consensus comes from clustering, not vibes.** Comments are cleaned, deduped, clustered by shared topics (deterministic mock by default), and only then labeled. Counts of comments/authors per cluster back every consensus/disagreement claim.

## 2. Repository structure

```
SignalTap/
├── package.json                 # npm workspaces root
├── tsconfig.base.json           # strict TS base
├── packages/
│   ├── schemas/                 # Zod schemas + types (single source of truth)
│   │   └── src/index.ts         # ExtractedContent, AnalysisResult, scoring types…
│   └── analysis/                # provider-agnostic logic
│       └── src/
│           ├── score.ts         # transparent 8-dimension worth-attention score
│           ├── cluster.ts       # staged comment clustering + mock provider
│           ├── provider.ts      # provider interface, retry/timeout/abort, mock provider
│           └── llm.ts           # OpenAI-compatible structured-output provider
├── apps/
│   ├── backend/                 # Hono API (Node today, Cloudflare-compatible)
│   │   └── src/{index,analysis,validation}.ts
│   └── extension/               # Chrome MV3 extension
│       ├── sidepanel.html       # side panel entry
│       ├── public/manifest.json # MV3 manifest (minimal permissions)
│       ├── src/
│       │   ├── background.ts    # SW: open panel + inject content script
│       │   ├── content.ts       # message API + FAB + in-page fallback panel
│       │   ├── highlight.ts     # scroll-to-source + accessible highlight
│       │   ├── adapters/        # GenericArticle, Reddit, HackerNews,
│       │   │                    #   GitHubIssue, YouTube, GenericVisibleText
│       │   ├── panel/App.tsx    # side panel UI (React)
│       │   ├── store.ts         # fingerprint + local cache/history (chrome.storage)
│       │   └── api.ts           # backend client with schema validation
│       └── tests/
│           ├── unit/            # Vitest: adapters, scoring, schema, fingerprint…
│           ├── fixtures/        # local article/discussion HTML fixtures
│           └── e2e/             # Playwright extension tests
```

## 3. Local setup

Requirements: Node 20+ (tested with 22), npm 10.

> Note: the spec called for pnpm workspaces; `pnpm` was not installed on this machine and we avoid global installs, so the repo uses **npm workspaces** — functionally equivalent. You can run the same commands with pnpm by adding a `pnpm-workspace.yaml`.

```bash
npm install                # installs all workspaces
npm run build              # typecheck + build every workspace
```

## 4. Backend setup

```bash
npm run dev:backend        # starts API on http://localhost:8787 (tsx watch)
curl http://localhost:8787/health   # -> {"ok":true,"schemaVersion":"1.0"}
```

Environment template: `apps/backend/.env.example` → copy to `apps/backend/.env` (or export the vars).

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API port |
| `SIGNALTAP_API_KEY` | *(empty)* | Optional client auth (`x-signaltap-key`). Empty = open dev mode. |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins. Use `*` only for local dev. |
| `RATE_LIMIT_PER_MIN` | `20` | Per-client request budget |
| `OPENAI_API_KEY` | *(empty)* | **Empty → deterministic mock provider.** Set to enable the real LLM. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for analysis |
| `ANALYSIS_TIMEOUT_MS` | `60000` | Per-call timeout |
| `ANALYSIS_RETRIES` | `1` | Retries on retryable failures |

**Important:** no API keys ever ship in the extension. All paid model calls go through the backend.

## 5. Install the extension in Chrome / Edge (unpacked)

1. Build it:
   ```bash
   npm run build:extension
   ```
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/dist`.
4. Open any article or discussion page, click the **SignalTap** toolbar icon (or the floating ⛉ button).
5. The side panel opens and runs the analysis. Click any `#source` chip to jump to and highlight the evidence.

To use the real model instead of the mock: set `OPENAI_API_KEY` in the backend env, restart the backend, and re-analyze.

## 6. Testing

```bash
npm run test:unit          # Vitest: adapters, scoring, schema, fingerprint, backend API
npm run test:backend       # backend API tests (validation, rate-limit, CRUD, feedback)
npm run test:e2e           # Playwright: builds the extension, loads it into Chromium,
                           #   runs the article + discussion loops against local fixtures
```

Playwright needs a Chromium browser download the first time:

```bash
npx playwright install chromium
# On this machine the ms-playwright cache is project-local to avoid the
# Windows safe-delete shim; export it before running e2e:
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
```

Notes:
- The e2e suite launches a **headed** Chromium window (extensions are ignored in headless mode) — the article + discussion loops run against local fixtures with the real backend.
- A `prebuild-clean` step clears `dist/`/`test-results/` before builds, working around the Windows safe-delete shim that makes Vite/Playwright abort when deleting directories.

Unit test coverage includes: adapter selection, article extraction, discussion normalization, source-ID stability, capture-scope classification, score calculation, schema validation, content fingerprinting, prompt-injection resistance, malformed model output, provider timeouts, rate limiting, and content-size limits.

## 7. Packaging

```bash
# The build already emits everything Chrome needs in apps/extension/dist:
#   manifest.json · background.js · content.js · sidepanel.html · assets/
npm run build:extension
```

To distribute: zip the contents of `dist/` and publish to the Chrome Web Store (requires a store account, privacy policy, and icon assets — the MVP uses the default action icon). Edge Add-ons accepts the same build. Add `icons/16.png|48.png|128.png` and reference them in the manifest before store submission.

## 8. Privacy model

- **Analysis only after an explicit click.** No content extraction before the user activates SignalTap on the active tab.
- **Minimal permissions** — see §9. No continuous browsing collection, no background surveillance.
- **Capture scope is disclosed** in the panel (full page / loaded content / visible text / transcript) and every extraction limitation is surfaced to the user.
- **No raw page text in logs or analytics.** The backend logs only host, page type, counts, provider, score, and latency. Feedback stores no content.
- **Local-first storage.** Results, history, and settings live in `chrome.storage.local`; history and content retention can be disabled, single results deleted, or all cleared in Settings.
- **Short-lived server processing.** The backend holds analyses in memory only (no database in the MVP); `DELETE /v1/analysis/:id` removes them.
- **Prompt-injection resistance.** Extracted content is delimited as *data*, the system prompt forbids following page-provided instructions, output is validated against the Zod schema, and the UI never renders raw model HTML.
- **Optional key access.** With `OPENAI_API_KEY` set, content passes through the backend to the model — delete controls remain client-side.

## 9. Requested permission rationale

| Permission | Why |
| --- | --- |
| `activeTab` | One-time access to the page you clicked on. Replaced "read all sites" (`<all_urls>`) — nothing is read until you click. |
| `sidePanel` | The in-UI analysis surface (Chrome 114+). |
| `storage` | Local cache, history, and settings. All data stays on your device. |
| `scripting` | Injects the page extractor into the active tab on demand. |

No `host_permissions`, no `tabs` history access beyond the active tab, no `webRequest`/network interception.

## 10. Adapter coverage (current)

| Adapter | Triggers | Extracts |
| --- | --- | --- |
| `YouTubeAdapter` | youtube.com / youtu.be | Title, author, description; **transcript** when the transcript panel is open; else a clear "transcript not available" warning |
| `RedditAdapter` | reddit.com | Post body, comment hierarchy, scores, authors, permalinks, deleted/collapsed markers |
| `HackerNewsAdapter` | news.ycombinator.com | Story text, comment hierarchy (indent-based), authors, permalinks |
| `GitHubIssueAdapter` | github.com issues/discussions/PRs | Issue body + comments, authors, reaction counts, permalinks |
| `GenericArticleAdapter` | article/main containers, og:type=article, ≥3 paragraphs | Readability-style content, heading hierarchy, author/date, paywall hints |
| `GenericVisibleTextAdapter` | everything else (fallback) | Visible text blocks, `visible_content` scope with an honest warning |

## 11. Known extraction limitations

- **SPA pages** (new Reddit, Twitter/X, most React apps) render progressively; SignalTap can only see what's loaded. Adapters selectors are conservative and may miss lazily-rendered comments.
- **Reddit/HN/GitHub selectors are heuristic**, tuned for the included fixtures and common markup; site redesigns can break them (the generic adapter then takes over).
- **Paywalls** can't be bypassed; SignalTap flags paywall language and treats the result as incomplete.
- **YouTube transcripts** require the transcript panel to be open; no automated fetching of transcript APIs.
- **HN comment scores** are not public; they're treated as 0.
- **Images, tables, and code blocks** are extracted as text only in the MVP.

## 12. Estimated AI cost per analysis

Using the default `gpt-4o-mini` with typical article content (~2–8k tokens in, ~1k tokens out):

| Content size | Est. input tokens | Est. output tokens | Est. cost (gpt-4o-mini) |
| --- | --- | --- | --- |
| Short article | ~1.5k | ~1k | ≈ $0.0007 |
| Medium article | ~4k | ~1.2k | ≈ $0.0015 |
| Long article / large thread | ~10k | ~1.5k | ≈ $0.0035 |
| Very large thread (>24k chars) | truncated to limits | ~1.5k | capped by design |

The **mock provider costs $0** and is the default — ideal for development, demos, and tests. Token/cost estimates are tracked internally for debugging without exposing content to analytics.

## 13. Next recommended experiment

After validating the desktop loop, the highest-leverage experiment is **Phase B: the Android Share Target** — users share a URL/text/screenshot from any app into SignalTap, reusing the same backend and analysis schema with near-zero new server work. Only after that loop is proven should Phase C (one-tap overlay) be explored, since it requires careful accessibility/MediaProjection consent design that the desktop product will have already stress-tested for you.

---

*MVP scope: desktop extension for Chrome/Edge. Android (Share Target / one-tap) is designed for but deliberately not implemented until the desktop loop is usable — see the product spec for the phased roadmap.*
