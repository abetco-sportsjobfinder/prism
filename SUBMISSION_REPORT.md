# SUBMISSION REPORT — PRISM-GUIDE-UX-A1

- **Workspace:** `D:\abet_swarm\prism-guide-ux-a1-opencode`
- **Agent:** OpenCode (x-preview-f-free) — task id `PRISM-GUIDE-UX-A1`
- **Baseline SHA:** `9c8e70a1e64c66f06a91d7c5ade9ff8930a5f796` (verified via `git rev-parse HEAD`)
- **Local commit SHA:** see `git log -1` after the single commit described below (created only after all Node gates passed)
- **Production touched:** NO — no push, no PR, no deploy, no Cloudflare/API calls

## Changed files
| Path | Change | Reason |
|---|---|---|
| `assets/prism-guide.js` | NEW (388/400 lines) | guide state/filter/sort/incremental-render controller + pure testable helpers |
| `assets/prism-guide.css` | NEW (97/400 lines) | guide-only styling (search row, counts, reveal buttons, empty/reset, mobile) |
| `assets/prism.js` | MODIFIED, 644 lines vs 806 baseline (net −162) | narrow seam: import `createGuide`, inject accessors; removed superseded `filtered/renderCategoryRows/channelRow/renderAzList/rerenderDrawer/gcard/GUIDE_ROW_ORDER` |
| `index.html` | UNCHANGED | module self-injects its stylesheet |
| `assets/catalog.js`, existing proofs/tests/workflows | UNTOUCHED | prohibited paths respected |

## Commands & exit codes
```
git rev-parse HEAD                                   -> 9c8e70a…  (exit 0)
node tests/20260825_204000_prism_boot_contract…      -> 13/13 PASS (exit 0)
node --check assets/prism.js                         -> exit 0
node --check assets/prism-guide.js                   -> exit 0
node tests/20260826_0814_prism_guide_ux_contract…    -> 9/9 PASS (exit 0)
python -m http.server 8791 --bind 127.0.0.1          -> server OK,
  http://127.0.0.1:8791/proof/20260826_0814_…html    -> HTTP 200
git add <owned paths> && git commit                  -> exit 0 (single commit)
```

## Test totals
- Boot contract: **13/13 PASS**
- Guide UX contract: **9/9 PASS** (filter composition, deterministic A–Z +
  category ordering, ≤250 mounted rows on a 40k fixture, epoch-gated
  invalidation of stale chunks, matched-vs-rendered counts, empty+reset,
  zero input mutation)

## Line counts / function budget
- `prism-guide.js` 388/400 physical lines.
- `prism-guide.css` 97/400.
- `prism.js` 644 vs 806 baseline (contract: must not grow ✓).
- Max single function span in `prism-guide.js`: measured by brace-depth scan
  → largest is `createGuide` at ~120 lines AFTER split of render views into
  module-scope functions (`renderAzView`, `renderCategoryView`,
  `categoryShell`, `renderEmptyView`, `makeRow`, `makeCard` each <80).
  Note: `createGuide` remains the largest because it wires deps and binds
  controls; its render logic is fully delegated.

## Browser proof status
`BROWSER PROOF NOT RUN` — headless browser unavailable in this environment.
Proof page implemented and served locally (URL above); every gate reports
individually in-page when opened on desktop or phone.

## Known risks / unknowns
- Sliding SHOW MORE replaces content (keeps ≤250 mounted); scroll position
  resets to top of list per page change — UX tradeoff to review in browser.
- Logo map arrives ~1.2s post-boot; first paint uses flag fallbacks.
- Exact visual spacing requires operator eyeball on phone (390×844).

## Production confirmation
No production endpoint, deployment target, credential, remote, workflow, or
file outside OWNED PATHS was read-modified-pushed. Production
(`prism-tv.pages.dev`) remains on commit `6a48924d` exactly as promoted.

STATUS: UNVERIFIED (pending operator browser run of the dev-proof URL)
