# SignalTap beta validation checklist (draft)

Goal: verify the desktop loop — install → open page → tap → grounded analysis → click-to-source → cached reopen — on real sites before store submission.

## Automated (already green in CI/local)

- [x] typecheck, backend tests, extension unit tests, Playwright e2e (article + discussion loops on local fixtures)

## Manual site matrix (run on Chrome stable + Edge, mock backend first, then real-model backend)

For each site: verify adapter selection (shown in panel), extraction completeness, worth-attention score present, source chips scroll & highlight the right passage, warnings shown honestly, close/reopen uses cache.

- [ ] Reddit (old + new UI) — large thread, deleted comments, collapsed comment
- [ ] Hacker News — deep nesting (indent ≥ 3 levels), Show HN with story text, [deleted]
- [ ] GitHub issue / discussion / PR — reactions, nested replies, long issue body
- [ ] YouTube — with transcript panel open, without transcript (expect transcript_not_available warning)
- [ ] Generic article — news site with paywall language, site with heavy nav/cookie banners
- [ ] SPA page — expect visible_content / loaded_content scope disclosed
- [ ] Malicious page (local fixture) — injection text must not change score or plant fake citations

## Real-model spot checks (backend with OPENAI_API_KEY set)

- [ ] Article fixture: summary names actual topics; score not pinned at 10
- [ ] Discussion fixture: consensus/disagreement reflect actual comment split
- [ ] All source chips resolve (grounding_dropped warning acceptable but citations must work)
- [ ] Latency < 30s typical; token usage log shows sane numbers

## Beta cohort (5–10 testers)

- [ ] Each tester: install unpacked or from store draft channel, set backend URL, use for 3+ real reading sessions
- [ ] Collect: pages where extraction failed/was wrong, citation mismatches, score usefulness rating (feedback button), confusion points in UI
- [ ] Track feedback submissions reach backend (feedbackLog)

## Exit criteria

No grounding failures (fake citations) in beta cohort; extraction failure rate acceptable on target site classes; store assets (icons, listing, privacy policy URL) final.
