# SignalTap — Chrome Web Store listing (draft)

## Name
SignalTap — One tap. Just the signal.

## Short description (132 chars max)
One tap. Just the signal. An AI information-judgment layer that analyzes the page you are already viewing — with every conclusion linked back to its source passage.

## Summary
SignalTap tells you what the page you're reading is actually saying, whether it's worth your time, what's fact vs. opinion vs. speculation, and where people agree or disagree — in one tap, without copying or pasting.

- **One-tap analysis** of the article or discussion you're already viewing — nothing is read until you click.
- **Worth-your-time score** computed from 8 transparent dimensions, adjusted to your relevance profile (developer, student, researcher, and more). A content-prioritization aid, not a truth score.
- **Every claim is grounded**: click any source chip to jump to and highlight the exact passage it came from. Fake or unresolvable citations are dropped automatically.
- **Discussion intelligence**: consensus, disagreements, and top comments from Reddit-style threads, Hacker News, GitHub issues, and more.
- **Local-first**: results, history, and settings stay on your device. Delete anything (or everything) in Settings.

## Category
Productivity

## Permissions rationale (shown to users)
- `activeTab` + `scripting`: the page is analyzed only when you click the SignalTap icon — no continuous access.
- `sidePanel`: shows the analysis in Chrome's side panel.
- `storage`: keeps your local cache, history, and settings on your device.

## Privacy practices (declared)
- Website content is processed only after an explicit click and is sent to the analysis backend you configure (default: local backend with a deterministic mock provider; a real AI model only if the backend has an API key configured).
- No browsing history collection, no analytics, no advertising, no sale of data.
- See `docs/PRIVACY.md` for the full policy.
