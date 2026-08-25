# prism — any stream, any screen

Independent, embeddable AV module in the **ABET design system**
(tokens/chrome copied 1:1 from `E:\abet\dashboard\src\styles\App.css`).
No framework. No build step. Import it into any page or dashboard.

## Piece 000 (this commit)
- ABET dashboard **header**: hamburger · glitch logo (`◇prism`) · dot-matrix
  ticker · status pill (`READY / TAP ▶ / ON AIR / ERROR`)
- Collapsible **NAVIGATION** bar with pill row — WATCH active;
  TV GUIDE / MULTI-VIEW / SOURCES ghosted (declared roadmap, disabled)
- **Rounded player** (16px radius panel) that plays anything:
  - `.m3u8` → hls.js (lazy CDN) → native HLS fallback (Safari)
  - `.mpd`  → dash.js (lazy CDN)
  - everything else → native `<video>` (mp4/webm/mov/ogg/mkv*)
  - local files via FILE… picker (object URLs)
- Deep link: `?src=<encoded url>` loads on open (muted autoplay attempt)
- Live verify step inside CI asserts the module is actually served

## Embed contract
```html
<script type="module">
  import { mountPrism } from '/assets/prism.js';
  const { player } = mountPrism({ target: document.querySelector('#slot') });
  await player.load('https://example.com/live.m3u8');
</script>
```
Exports: `mountPrism`, `mountHeader`, `mountNavSection`, `mountPlayer`,
`statusPill`. Styling is namespaced under `.app.crt-effect` + component classes
that intentionally match ABET dashboard names so a shared stylesheet can later
dedupe.

## Roadmap (one piece at a time)
1. ~~Piece 000 — header + universal rounded player~~ ✅
2. Piece 001 — nav pills come alive: SOURCES (URL/file presets persisted per device)
3. Piece 002 — MULTI-VIEW: split display area N-up, per-tile engine reuse
4. Piece 003 — TV GUIDE: EPG grid (D1-backed when wired to edge)
5. Piece 004 — tablet-remote pairing (code over WebSocket), AirPlay/Cast hooks
