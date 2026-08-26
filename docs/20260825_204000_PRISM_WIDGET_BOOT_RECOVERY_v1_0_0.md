# PRISM Widget Boot Recovery v1.0.0

**Recorded:** 2026-08-25 20:40:00 UTC  
**Environment:** isolated development clone  
**Branch:** `codex/prism-widget-recovery-20260825-133200`  
**Production changed:** no

## Scope

Restore the independent PRISM widget to a bootable state without redesigning it or deploying to production. The product contract remains: one embeddable module is proven independently before ABET dashboard integration.

## Reproduced production failure

The deployed page at `https://prism-tv.pages.dev/` throws:

```text
TypeError: Cannot read properties of undefined (reading 'appendChild')
createWindow assets/prism.js:624
```

The initial player does not mount, the catalog never reaches a usable UI, and the loading state remains stranded.

## Root causes

1. `addWindow()` called `spawnWindow(stage)`, while `spawnWindow` destructured an object parameter. The DOM element was therefore treated as `{ stage }`, yielding `undefined`.
2. `createWindow()` queried and dereferenced `.pwin-loading`, but the generated player markup did not include that element.
3. The prior session's source-string called-vs-defined audit could not detect either runtime DOM-contract failure. Browser execution is now mandatory for promotion.

## Development repair

- `spawnWindow` now accepts the stage element and explicitly passes `{ stage }` to `createWindow`.
- `createWindow` rejects an invalid stage with a precise error.
- Every player window now creates the `.pwin-loading` element its lifecycle handlers use.
- A standalone proof page mounts the same `assets/prism.js` module used by the product and exposes browser-visible PASS/FAIL gates.

## Verification gates

```powershell
node --check assets/prism.js
node tests/20260825_204000_prism_boot_contract_v1_0_0.mjs
python -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/proof/20260825_204000_PRISM_WIDGET_DEV_PROOF_v1_0_0.html
```

Promotion requires all twelve browser gates, zero console errors, desktop and mobile rendering, a branch-only hosted preview, and operator review. Production `main` must not be changed before those gates pass.

## Hosted development verification

Branch preview:

```text
https://prism-dev-v1.prism-tv.pages.dev/
```

Independent proof:

```text
https://prism-dev-v1.prism-tv.pages.dev/proof/20260825_204000_PRISM_WIDGET_DEV_PROOF_v1_0_0.html
```

Immutable deployment:

```text
https://e6b2d418.prism-tv.pages.dev
```

Observed in a real browser on desktop and at a 390x844 phone viewport:

- Boot contract: `12/12 PASS`
- Runtime console errors: `0`
- Indexed channels: `40,726`
- Country options: `61`
- Category rows: `30`
- Horizontal overflow: `0 px`
- Initial players: `1`
- Verified-working status: `WARN` because the existing status Worker CORS allowlist rejects the preview hostname; this is explicitly not certified by the boot receipt.

Production `https://prism-tv.pages.dev/` remains unchanged at broken commit `b5b5627` during development review.

Branch deployment workflow receipt:

```text
https://github.com/abetco-sportsjobfinder/prism/actions/runs/32917528173
```

## Backup and rollback

Pre-change backup:

```text
D:\abet_dev\backups\prism_widget_recovery_20260825_133650_BEFORE_boot_fix\prism.js
```

Rollback is the parent commit `b5b5627`. Do not run a rollback command unless the operator explicitly requests it.
