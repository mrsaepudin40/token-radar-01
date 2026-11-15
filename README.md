# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mrsaepudin40/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mrsaepudin40/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by implied value: every protocol with no token on record, priced by what the market already pays for live protocols in its category. The radar-2 model takes each category's multiple from the snapshot's own live comps (median mcap / TVL, shrunk toward the global median, capped when a category has few comps), then multiplies by TVL, a clamped seven-day growth factor and a maturity factor for how long the protocol has run with no token. On the 2026-11-14 snapshot it scores 178 pre-token rows (40 watchlist + 138 early), led by Steakhouse Financial at $657.8M implied. A static dashboard ships with the board: search, category filter, pre-token / live tabs, a top-10 chart, the live comps table, a "why this rank" breakdown per protocol and a chain-aware farm plan for each row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json`, `data.js` and `dossier.json` to the output directory, and copies `dashboard/` and `screenshots/` there. It needs three screenshots in `screenshots/` (the board, a detail view and a filtered view) or it exits 1. Open `out/dashboard/index.html` to browse the board offline; it reads `out/data.js` and makes no network requests.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
