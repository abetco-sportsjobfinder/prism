# PRISM Widget Production Promotion v1.0.0

**Recorded:** 2026-08-26T05:20:42Z  
**Production URL:** `https://prism-tv.pages.dev/`  
**Promoted commit:** `6a48924dafa6e1b03dd3d9b7781063b2795b09a0`  
**Source branch:** `codex/prism-widget-recovery-20260825-133200`

## What Was Published

The production site had remained on broken commit `b5b5627`. The prior work published only an isolated development deployment at `https://e6b2d418.prism-tv.pages.dev/`; it did not modify `https://prism-tv.pages.dev/`.

After development verification, the three-commit branch was fast-forwarded to `main`. There was no divergence from `main` and no unrelated production code was overwritten. The production delta contains:

- the six-line player boot repair in `assets/prism.js`;
- the executable static boot contract;
- the independent development proof page;
- the machine-readable development receipt;
- the recovery documentation; and
- the generated-cache ignore rule.

## Production Browser Proof

A new browser session loaded `https://prism-tv.pages.dev/` after the deployment completed. Observed results:

- initial player windows: `1`;
- indexed channels: `40,766`;
- verified-working channels: `3,353`;
- country choices: `61` including the global option;
- category guide rows: `30`;
- category cards currently rendered: `701`;
- sort choices: `CATEGORY` and `A-Z`;
- horizontal overflow: `0 px`; and
- new-session console warnings/errors: `0`.

The country filter was exercised in the `A-Z` view. Selecting `US` produced `759` visible channel rows; the first 15 rows carried country code `US`, and the complete visible result contained `0` non-US country codes. The controls were restored to `CATEGORY` and global country after the test.

## Deployment Receipt

GitHub Actions run:

```text
https://github.com/abetco-sportsjobfinder/prism/actions/runs/32933511144
```

The workflow completed successfully in 24 seconds. It also emitted a maintenance warning: `actions/checkout@v4` and `cloudflare/pages-action@v1` target deprecated Node.js 20 and were forced to Node.js 24. That warning did not block this deployment but remains a CI maintenance item.

## Rollback

The pre-promotion production commit is `b5b5627084abba24e3fe41d80efb42f9f657976b`. Rollback must be performed only through a deliberate revert commit; do not rewrite `main` history.
