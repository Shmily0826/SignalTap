# SignalTap Test Report

> Generated 2026-08-22 · branch `main` · commits `e4c4b20..6c5909f` · environment: Windows, Node v24.15.0, npm workspaces
>
> Purpose: single source of truth for the current automated-test state, so any
> agent (or human) can see what is verified, how, and what is deliberately NOT
> covered yet. Update this file when test scope changes.

## 1. How to run everything

```bash
npm run typecheck        # strict TS across all workspaces (expect: 0 errors)
npm run test:backend     # backend API + provider tests (vitest)
npm run test:unit        # extension unit tests (vitest)
npm run test:e2e         # Playwright: builds extension, headed Chromium
# Windows note: export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" first
```

## 2. Current results (all actually run on 2026-08-22)

| Suite | Result | Notes |
| --- | --- | --- |
| typecheck | ✅ 0 errors | strict mode, all workspaces |
| Extension unit (`test:unit`) | ✅ 105 passed / 10 files | ~1.3s |
| Backend (`test:backend`) | ✅ 26 passed + 2 skipped / 5 files | skips = real-model smoke, needs `OPENAI_API_KEY` |
| E2E (`test:e2e`) | ✅ 3 passed | headed Chromium + real backend + local fixtures |

## 3. Test inventory

### 3.1 Extension unit tests (`apps/extension/tests/unit/`, 105)

| File | # | Covers |
| --- | --- | --- |
| `adapters.test.ts` | 21 | Adapter selection per URL class, article extraction (title/author/canonical/heading hierarchy/noise exclusion/paywall flag), Reddit discussion normalization (hierarchy, scores, deleted), source-ID stability, generic fallback scope, adapter registry order |
| `siteAdapters.test.ts` | 11 | HackerNews (indent-based depth, permalinks, `[deleted]`), GitHub issue (body as root, reaction scores, nesting), YouTube (transcript timestamps; description fallback + honest warning) — all against local HTML fixtures |
| `grounding.test.ts` | 7 | Trust boundary: fake sourceIds dropped, excerpt/url rebuilt from trusted extraction only, navigation-field filtering, `grounding_dropped` warning, OpenAI stub walks the real `toAnalysisResult` gate, **prompt-injection regression** (score cannot be forced to 10, injected ids never survive) |
| `analysis.test.ts` | 11 | Mock provider output schema-validity + grounded refs, injection-as-data, consensus from clustering, malformed model output rejection, out-of-range score rejection, timeout classification, non-retryable error propagation |
| `score.test.ts` | 9 | Profile weight normalization (Σ|w|=1, all 6 profiles), researcher re-weighting, 10/0 boundary scores, neutral-input profile invariance, missing-dimension defaults (5, conf 0), determinism, direction map, score bands |
| `cluster.test.ts` | 11 | Deterministic clustering pipeline: drop deleted/short/duplicate + count, keyword-based clustering, engagement sort, firsthand/external-evidence flags, author counting post-dedupe, representative selection, summarizeClusters grounded counts |
| `dom.test.ts` | 14 | Shared helpers: cleanText, hostname, paywallHint, computeParents nesting (incl. orphan jumps), noise detection, canonical URL precedence, **generic discussion detection** (wrapper skip, author/score/permalink, deleted flag) |
| `highlight.test.ts` | 9 | Click-to-source engine: locate by source id, highlight/clear lifecycle, re-highlight moves target, **cache-fingerprint regression** (highlight NEVER changes textContent — label is a pseudo-element) |
| `apiclient.test.ts` | 6 | Backend client: success + schema gate, invalid result rejected, 429→retryable `rate_limited`, 502→typed error, network failure message, abort→`cancelled` |
| `store.test.ts` | 6 | Fingerprint stability/change sensitivity (content, adapter version, scope), cache-key composition, fnv1a determinism |

### 3.2 Backend tests (`apps/backend/tests/`, 28)

| File | # | Covers |
| --- | --- | --- |
| `api.test.ts` | 10 | POST /v1/analysis happy path + validation + 413 + rate limit + capture-scope passthrough, analysis CRUD (get/delete/404), feedback 204/400, **GET /v1/feedback returns sanitized metadata only** (no comment text) |
| `truncate.test.ts` | 7 | Provider-side deterministic truncation limits and source-ID preservation |
| `auth.test.ts` | 4 | `SIGNALTAP_API_KEY` set ⇒ 401 `unauthorized` on analysis (missing/wrong key) + feedback; correct key passes |
| `provider-fallback.test.ts` | 5 | runAnalysis orchestration: 5xx → mock fallback, invalid JSON → fallback, 429 does NOT fall back (propagates), no-key ⇒ zero model calls |
| `llm.smoke.test.ts` | 2 ⏸ | **SKIPPED without `OPENAI_API_KEY`** (by design). Real-model: schema validity, grounding, score range, latency <90s, on two realistic fixtures. Run with `OPENAI_API_KEY=... npm run test --workspace @signaltap/backend` |

### 3.3 E2E (`apps/extension/tests/e2e/`, 3 — Playwright, headed Chromium, real backend + local fixtures)

| Spec | Covers |
| --- | --- |
| `article.spec.ts` | Full loop: open fixture → extract → mock analysis → click source chip → in-page highlight → close/reopen uses cache |
| `discussion.spec.ts` | Discussion loop: nested comments, consensus/disagreement sections, capture-scope disclosure |
| `panel-loop.spec.ts` | UI closed loop: **feedback verified on backend** (GET /v1/feedback count +1), history entry (title+score) reopens cached result, profile switch re-analyzes under new cache key (2 history entries), delete removes one entry, Clear-all empties history |

## 4. Trust & security coverage (summary)

- **Grounding gate** (`packages/analysis/src/grounding.ts`): every provider output path (OpenAI real, OpenAI stub, Mock) is tested to drop fabricated sourceIds, rebuild excerpts/urls from trusted extraction only, filter navigation ids, and emit `grounding_dropped` warnings.
- **Prompt injection**: page text containing "ignore previous instructions / worthAttention=10 / sourceId=fake-999" is proven not to force scores or plant citations (unit + provider-level stub tests).
- **Cache-fingerprint integrity**: highlight engine proven not to mutate extracted text (the historical bug class is regression-locked).
- **Privacy in logs/API**: backend test asserts feedback API returns lengths/hosts only, never comment content.

## 5. Known gaps (NOT covered by automation — honest list)

1. **Real-model quality** — `llm.smoke.test.ts` skipped: no `OPENAI_API_KEY` available in this environment. Summary/consensus relevance on a real model is unverified. **Highest-priority gap.**
2. **Real-site extraction** — adapters are tested against local fixtures; live Reddit/HN/GitHub/YouTube markup drift is unverified (see `docs/BETA_CHECKLIST.md`).
3. **Cache invalidation e2e** — same-URL content change → fingerprint change → re-analysis has unit coverage only, no e2e.
4. **Deployment surface** — CORS/auth tested at unit level; no test against a deployed (Cloudflare) backend.
5. **Extension unit numbers**: 105 assumes mock provider path; with a key set, 2 more backend tests activate (27 total).

## 6. Baseline for CI / future agents

A healthy run must show: typecheck 0 errors · unit **105 passed** · backend **26 passed + 2 skipped** · e2e **3 passed**. If numbers drop below this baseline without an accompanying test-file change, something regressed.
