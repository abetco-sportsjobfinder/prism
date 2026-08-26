# PRISM Guide UX Implementation v1.0.0

**Recorded:** 2026-08-26T08:14Z
**Baseline:** `abetco-sportsjobfinder/prism@9c8e70a1e64c66f06a91d7c5ade9ff8930a5f796`
**Task:** PRISM-GUIDE-UX-A1 — coherent player + television guide
**Status:** UNVERIFIED (browser proof not executed by agent)

## What was built

A single new guide module (`assets/prism-guide.js`) now owns all guide
state, filtering, sorting, incremental rendering, counts and empty/reset
UX. `assets/prism.js` keeps only a narrow integration seam: it constructs
the controller with injected accessors (`db.channels`, `getStatus`,
`hasStream`, `countries()`, `pickStream`), hands over the drawer element,
control elements, favorites set, and play callbacks, and listens for two
custom events (`prism:drawer`, `prism:toast`) to close the drawer and
surface streamless-channel notices.

### User-visible contract mapping
| Requirement | Where |
|---|---|
| Player/canvas visually separate from guide | `.stage-area` vs `.drawer` (existing chrome) |
| Toolbar: search/WORKING/sort/country/caret/counts | dock bar (prism.js) + drawer search row & counts line (guide) |
| Search case-insensitive, trimmed, composes | `normalizeQuery` + `filterChannels` |
| CATEGORY headings + counts | `groupByCategory` → `.guide-row-title .count` |
| A-Z true alphabetical | `sortAZ` (strict name compare) |
| Country filter incl. global restore | controller state + `<select>` |
| Empty explains filters + reset | `renderEmptyView` + `activeFilterLabels` + RESET button |
| Tap plays focused / ＋ opens new player | row click vs `.row-new` button |
| Layouts/SOURCE/mute/close/favorites preserved | untouched in prism.js window factory |
| ABET chip loader reused during catalog load | existing `chipHTML()` in dock meta + player overlay |

### Performance contract mapping
| Requirement | Mechanism |
|---|---|
| Never mount tens of thousands of rows | A–Z uses `AzPager` (250/page) with explicit SHOW MORE that **replaces** content (sliding cap) |
| ≤250 mounted A-Z rows at once | enforced by pager page size = 250; proven by G6 on a 40,000-row fixture |
| Category shells ≤24 initial cards | `CAT_INITIAL=24`, per-shell reveal `+24` via deterministic button |
| Filter changes cancel stale incremental work | `scheduleChunk`/`cancelChunk` epoch guard (G7); every control change synchronously rebuilds via `rerender()` |
| Matched vs rendered exposed separately | `computeCounts` + drawer line `N MATCHED · M RENDERED` (G8) |

### Modularity contract compliance
- `assets/prism-guide.js`: 388/400 lines.
- `assets/prism-guide.css`: 97/400 lines (new file, self-injected by module).
- `assets/prism.js`: **644 lines vs 806 baseline** (shrank; superseded guide
  code removed: `filtered()`, `renderCategoryRows()`, `channelRow()`,
  `renderAzList()`, `rerenderDrawer()` body, `gcard()`).
- `index.html`: unchanged (module self-injects its stylesheet).
- `assets/catalog.js`: untouched.
- No function fetches + filters + renders + binds together:
  fetching lives only in catalog.js; pure helpers do no DOM;
  controller functions each do one concern.

## Verification performed locally
| Command | Result |
|---|---|
| `git rev-parse HEAD` | `9c8e70a1e64c66f06a91d7c5ade9ff8930a5f796` |
| `node --check assets/prism.js` | exit 0 |
| `node --check assets/prism-guide.js` | exit 0 |
| `node tests/20260825_204000_prism_boot_contract_v1_0_0.mjs` | 13/13 PASS |
| `node tests/20260826_0814_prism_guide_ux_contract_v1_0_0.mjs` | 9/9 PASS |

Local HTTP server for the proof page:
`python -m http.server 8791 --bind 127.0.0.1` (cwd = workspace)
URL recorded: `http://127.0.0.1:8791/proof/20260826_0814_PRISM_GUIDE_UX_DEV_PROOF_v1_0_0.html`
(HTTP 200 confirmed via curl-equivalent HEAD-less request)

**BROWSER PROOF NOT RUN** — headless browser unavailable in this build
environment. All browser gates are implemented in the proof page and will
report individually when opened. STATUS remains UNVERIFIED until an
operator opens the URL on desktop + phone and records results.

## Known risks / unknowns
- Real-browser behavior of the 250-cap sliding SHOW MORE (content replace)
  is unverified pending operator browser run.
- Logo map arrives ~1.2s after boot; first paint shows flag fallbacks.
- `pickStream` failures toast via `prism:toast`; visual styling relies on
  existing `.toast` rule in prism.css.

## Production
Untouched. No push, no deploy, no Pages/Workers/API calls. One local
path-scoped commit contains only owned paths.
