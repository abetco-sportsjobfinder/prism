# PRISM Guide UX OpenCode Handoff v1.0.0

**Recorded:** 2026-08-26T07:35:26Z  
**Baseline:** `abetco-sportsjobfinder/prism@9c8e70a1e64c66f06a91d7c5ade9ff8930a5f796`  
**Trust:** proposal only; Codex/operator must reproduce every gate before promotion

## Copy-Paste Prompt

```text
TASK ID: PRISM-GUIDE-UX-A1
STATUS CONTRACT: proposal-only; final status must be UNVERIFIED

You are improving one independent widget. Do not explore ABET, do not touch any production checkout, and do not deploy.

Create and work only inside:
D:\abet_swarm\prism-guide-ux-a1-<your-model-slug>

Clone https://github.com/abetco-sportsjobfinder/prism.git into that directory and check out exact baseline:
9c8e70a1e64c66f06a91d7c5ade9ff8930a5f796

Before editing, prove:
1. `git rev-parse HEAD` equals the baseline above.
2. `git status --short` is empty.
3. `node tests/20260825_204000_prism_boot_contract_v1_0_0.mjs` passes 13/13.

Read these files in order:
1. docs/20260825_204000_PRISM_WIDGET_BOOT_RECOVERY_v1_0_0.md
2. proof/20260825_204800_PRISM_WIDGET_BOOT_RECEIPT_v1_0_0.json
3. docs/20260825_222029_PRISM_WIDGET_PRODUCTION_PROMOTION_v1_0_0.md
4. proof/20260825_222029_PRISM_WIDGET_PRODUCTION_RECEIPT_v1_0_0.json
5. tests/20260825_204000_prism_boot_contract_v1_0_0.mjs
6. index.html
7. assets/catalog.js
8. assets/prism.js
9. assets/prism.css

OBJECTIVE
Turn the now-bootable PRISM widget into a coherent player plus television guide without regressing its proven catalog, source switching, multi-player layouts, or filtering. This is a development proposal only. Production remains untouched.

USER-VISIBLE CONTRACT
- A stable player/canvas area is visually separate from a stable guide area.
- The guide toolbar is always understandable and contains: channel-name search, WORKING toggle, CATEGORY/A-Z sort, country filter, collapse/expand, and visible result counts.
- Search is case-insensitive, trims whitespace, updates without reloading, and composes with country/WORKING/sort filters.
- CATEGORY mode groups channels with clear headings and counts.
- A-Z mode shows a true alphabetical list.
- Country selection shows only that country; global restores all countries.
- Empty results explain which filters are active and provide a clear reset action.
- Clicking a channel plays it in the focused player; the existing explicit new-player action still opens another player.
- Existing FULL/2x2/3x2/2x3/4x2/2x4 layouts, SOURCE selector, mute interaction, close controls, favorites, and working-status semantics remain functional.
- Preserve the current real catalog. Do not invent channels, working states, logos, countries, streams, or counts.
- Reuse the current ABET chip loader while catalog/status data are loading. Do not introduce a different fake logo or loader.
- Desktop and phone layouts must have no horizontal page overflow, no controls covering content, and no illegible fixed-width guide.

PERFORMANCE CONTRACT
- Never append tens of thousands of channel elements to the DOM at once.
- Keep no more than 250 channel-row/card nodes mounted in A-Z mode at one time using an explicit incremental/virtualized window.
- CATEGORY mode may render category shells, but each category initially renders at most 24 cards and provides a deterministic way to reveal additional matching channels.
- Filter/sort changes cancel or invalidate any previous incremental render before inserting new nodes.
- Expose rendered-count and matched-count separately so performance limits are never misrepresented as data limits.

MODULARITY CONTRACT
- Do not replace the entire `assets/prism.js` or `assets/prism.css` file.
- Put new guide state/filter/render logic in `assets/prism-guide.js`, maximum 400 physical lines and maximum 80 lines per function.
- Put new guide-specific styling in `assets/prism-guide.css`, maximum 400 physical lines.
- Modify `assets/prism.js` only for a narrow integration seam and removal of superseded guide code. The file must not grow in physical line count.
- Modify `index.html` only to load the new stylesheet/module integration if required.
- Do not create or commit backup copies. Git is the backup.
- No function may perform network fetch, filtering, rendering, and event binding together.
- Inject catalog/status access into the guide module; do not duplicate catalog fetching.

OWNED PATHS
- assets/prism.js
- assets/prism.css only if an existing rule must be removed
- assets/prism-guide.js (new)
- assets/prism-guide.css (new)
- index.html
- tests/<UTCSTAMP>_prism_guide_ux_contract_v1_0_0.mjs (new)
- proof/<UTCSTAMP>_PRISM_GUIDE_UX_DEV_PROOF_v1_0_0.html (new)
- docs/<UTCSTAMP>_PRISM_GUIDE_UX_IMPLEMENTATION_v1_0_0.md (new)
- SUBMISSION_REPORT.md (new)

Do not change `assets/catalog.js`, the existing dated proof/test/receipt files, workflow files, credentials, remotes, or any file outside the owned paths.

REQUIRED TESTS
1. Existing boot contract still passes 13/13.
2. `node --check assets/prism.js` passes.
3. `node --check assets/prism-guide.js` passes.
4. New Node test proves pure filtering composition: search + country + WORKING.
5. New Node test proves CATEGORY and A-Z ordering deterministically.
6. New Node test proves a 40,000-channel fixture never mounts more than 250 A-Z rows.
7. New Node test proves changing filters invalidates stale incremental work.
8. New Node test proves counts distinguish total matches from currently rendered rows.
9. New Node test proves empty state and reset behavior.
10. New Node test proves no input channel/catalog object is mutated.
11. Development proof page imports the actual production modules and reports each browser gate individually; it must not restate source-string checks as runtime proof.

Run a local HTTP server and record the exact URL. If your environment cannot execute a real browser, say `BROWSER PROOF NOT RUN` and leave the claim UNVERIFIED. Do not fabricate screenshots, visual results, channel counts, or console status.

SECURITY AND RELEASE RULES
- No `.env`, credentials, SSH, browser profiles, cloud consoles, deployment tools, Discord, or production endpoints requiring auth.
- No push, PR, merge, deployment, or production modification.
- Make one local path-scoped commit only after tests pass.
- Every new filename is UTC datetime-stamped and versioned except the required stable `SUBMISSION_REPORT.md`.
- Every factual claim cites a file, test output, or browser receipt.
- Unknown means UNKNOWN.

FINAL REPORT
Write `SUBMISSION_REPORT.md` containing: baseline SHA, local commit SHA, changed files with reasons, exact commands and exit codes, test totals, line counts, max function lengths, browser status, known risks, and confirmation that production was untouched.

Your chat response must be exactly:
WORKSPACE: <absolute workspace>
AGENT_ID: <provider-model-task-id>
REPORT: <absolute workspace>\SUBMISSION_REPORT.md
STATUS: UNVERIFIED
```

## Trusted Intake

Codex must compare the proposal against baseline `9c8e70a`, rerun both test suites, inspect the real browser on desktop and phone, and reject any production action until the operator reviews the development URL.
