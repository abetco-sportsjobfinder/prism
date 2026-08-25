/* ============================================================
   PRISM — independent, embeddable AV module (Piece 000).
   Exposes mountPrism({ target, title, ticker }) → { player }.
   Plays ANY http(s) stream or local file:
     .m3u8 → hls.js (lazy) → native HLS fallback
     .mpd  → dash.js (lazy)
     else  → native <video> (mp4/webm/mov/ogg/mkv-where-supported)
   No framework, no build step. Import from any page or dashboard.
   ============================================================ */

const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => bad(new Error('failed to load ' + src));
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- header ---------------- */
export function mountHeader({ target, logoHTML = '<span class="alpha">◇</span>prism', ticker = ['LIVE TV', 'ANY FILE • ANY STREAM', 'HLS • DASH • MP4'], right = [] }) {
  const header = el('header', 'header');
  const left = el('div', 'header-left');
  const burger = el('button', 'hamburger-btn', '<span></span><span></span><span></span>');
  burger.title = 'Menu';
  const logo = el('button', 'logo-btn glitch-text', logoHTML);
  left.append(burger, logo);

  const center = el('div', 'header-center');
  const dm = el('div', 'dot-matrix-container');
  const group = ticker.map(t => `<span>${esc(t)}</span><span class="separator">•</span>`).join('');
  // duplicated group => seamless translateX(-50%) loop
  dm.innerHTML = `<div class="dot-matrix-scroll">${group}${group}</div>`;
  center.appendChild(dm);

  const rightEl = el('div', 'header-right');
  for (const node of right) rightEl.appendChild(node);

  header.append(left, center, rightEl);
  target.appendChild(header);
  return { header, burger, logo };
}

export function statusPill(initial = 'READY') {
  const p = el('span', 'live-indicator connected',
    `<span class="live-dot"></span><span class="label">${esc(initial)}</span>`);
  return {
    el: p,
    set(state, text) {
      p.classList.toggle('connected', state !== 'error');
      p.classList.toggle('error', state === 'error');
      p.querySelector('.label').textContent = text;
    },
  };
}

/* ---------------- collapsible nav section ---------------- */
export function mountNavSection({ target, label = 'NAVIGATION', pills = [] }) {
  const section = el('div', 'collapsible-section');
  const toggle = el('button', 'collapse-toggle');
  toggle.innerHTML = `<span class="collapse-label">${esc(label)}</span><i class="fas fa-chevron-up"></i>`;
  const body = el('div', 'section-body');
  const nav = el('nav', 'sport-nav');
  for (const pill of pills) {
    const b = el('button', `sport-btn${pill.active ? ' active' : ''}`,
      `${pill.icon ? `<i class="fas ${pill.icon}"></i>` : ''}<span>${esc(pill.label)}</span>`);
    b.disabled = !!pill.disabled;
    if (!pill.disabled && pill.onClick) b.addEventListener('click', pill.onClick);
    nav.appendChild(b);
  }
  body.appendChild(nav);
  toggle.addEventListener('click', () => {
    section.classList.toggle('collapsed');
    toggle.querySelector('i').className =
      `fas fa-chevron-${section.classList.contains('collapsed') ? 'down' : 'up'}`;
  });
  section.append(toggle, body);
  target.appendChild(section);
  return { section, nav };
}

/* ---------------- universal player ---------------- */
export function mountPlayer({ target }) {
  const strip = el('div', 'panel-strip');
  strip.innerHTML = `
    <span class="strip-title"><i class="fas fa-tv" style="color:var(--accent-primary)"></i>
      SOURCE <span class="strip-sep">|</span> <span class="engine-badge">—</span></span>
    <input class="url-input" type="text" spellcheck="false" autocomplete="off"
           placeholder="Paste a stream or file URL — .m3u8 / .mpd / .mp4 / webm / mkv…" />
    <button class="strip-btn primary">LOAD</button>
    <button class="strip-btn">FILE…</button>
    <input type="file" accept="video/*,audio/*,.mkv,.m3u8" style="display:none" />`;

  const shell = el('div', 'player-shell');
  const video = document.createElement('video');
  video.controls = true; video.playsInline = true; video.preload = 'metadata';
  shell.appendChild(video);

  const errBox = el('div', 'player-error');
  const wrap = el('div', null);
  wrap.append(strip, shell, errBox);
  target.appendChild(wrap);

  const urlInput = strip.querySelector('.url-input');
  const badge = strip.querySelector('.engine-badge');
  const pillRef = { current: null };
  let engine = null; // hls | dash instance
  let objectUrl = null;

  function fail(msg) {
    errBox.textContent = msg;
    errBox.classList.add('show');
    pillRef.current?.set('error', 'ERROR');
    console.error('[prism.player]', msg);
  }
  function clearFail() { errBox.classList.remove('show'); }
  function setPill(fn) { if (pillRef.current) fn(pillRef.current); }

  function teardown() {
    if (engine?.destroy) { try { engine.destroy(); } catch {} }
    if (engine?.reset) { try { engine.reset(); } catch {} }
    engine = null;
    video.removeAttribute('src'); video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  function detect(url) {
    const clean = url.split('?')[0].toLowerCase();
    if (/\.m3u8($|\?)/i.test(url) || /\.m3u8$/i.test(clean)) return 'hls';
    if (/\.mpd($|\?)/i.test(url)) return 'dash';
    return 'native';
  }

  async function load(src, { isFile = false } = {}) {
    clearFail();
    teardown();
    try {
      let kind;
      if (isFile) {
        objectUrl = URL.createObjectURL(src);
        video.src = objectUrl; kind = 'file';
        badge.textContent = 'FILE';
      } else {
        kind = detect(src);
        if (kind === 'hls') {
          if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) {
            video.src = src; badge.textContent = 'NATIVE·HLS';
          } else {
            await loadScript(CDN.hls);
            if (!window.Hls?.isSupported()) { video.src = src; badge.textContent = 'NATIVE·HLS'; }
            else {
              engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
              engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`HLS fatal: ${d.details}`); });
              engine.loadSource(src);
              engine.attachMedia(video);
              badge.textContent = 'HLS.JS';
            }
          }
        } else if (kind === 'dash') {
          await loadScript(CDN.dash);
          engine = window.dashjs.MediaPlayer().create();
          engine.initialize(video, src, true);
          badge.textContent = 'DASH.JS';
        } else {
          video.src = src;
          badge.textContent = 'NATIVE';
        }
      }
      pillRef.current?.set('connected', 'PLAYING?');
      const ok = await video.play().then(() => true).catch(() => false);
      setPill(p => p.set(ok ? 'connected' : 'connected', ok ? 'ON AIR' : 'TAP ▶'));
      video.onplaying = () => pillRef.current?.set('connected', 'ON AIR');
      video.onwaiting = () => {};
      video.onerror = () => !isFile && fail(`Source refused to play (${kind}) — check CORS/reachability`);
    } catch (e) {
      fail(e.message || String(e));
    }
  }

  strip.querySelector('.strip-btn.primary').addEventListener('click', () => {
    const v = urlInput.value.trim();
    if (!v) { fail('Paste a URL first.'); return; }
    load(v);
  });
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') strip.querySelector('.strip-btn.primary').click(); });
  const fileBtn = strip.querySelectorAll('.strip-btn')[1];
  const fileInput = strip.querySelector('input[type=file]');
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) load(f, { isFile: true });
    fileInput.value = '';
  });

  const api = {
    video, load,
    attachStatusPill(pill) { pillRef.current = pill; },
    get engine() { return badge.textContent; },
  };
  return api;
}

/* ---------------- one-call bootstrap ---------------- */
export function mountPrism({ target, title = 'prism | any stream, any screen', ticker, navPills } = {}) {
  document.title = title;
  const app = el('div', 'app crt-effect');
  const content = el('div', 'app-content');
  target.appendChild(app);
  app.appendChild(content);

  const pill = statusPill('READY');
  mountHeader({
    target: app,
    ticker,
    right: [pill.el],
  });

  mountNavSection({
    target: app,
    label: 'NAVIGATION',
    pills: navPills ?? [
      { label: 'WATCH', icon: 'fa-play', active: true },
      { label: 'TV GUIDE', icon: 'fa-list-ul', disabled: true },
      { label: 'MULTI-VIEW', icon: 'fa-table-cells-large', disabled: true },
      { label: 'SOURCES', icon: 'fa-plug', disabled: true },
    ],
  });

  const player = mountPlayer({ target: content });
  player.attachStatusPill(pill);

  content.insertAdjacentHTML('beforeend',
    '<div class="footer-note">PRISM piece 000 · embeddable module · ABET design system</div>');

  // ?src= deep link (muted autoplay attempt per browser policy)
  const qp = new URLSearchParams(location.search).get('src');
  if (qp) {
    player.video.muted = true;
    player.load(qp);
  }

  return { app, player, pill };
}
