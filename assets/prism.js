/* ============================================================
   PRISM — Piece R4.
   Player: full-width, rounded, embossed (sunken into the page).
   Below: collapsible section with horizontally-scrolling category
   pill buttons + channel list filtered by active pill.
   Every channel visible — no hidden filters.
   ============================================================ */

import { loadCatalog, db, countries, categories, stats, getStatus, hasStream, pickStream } from './catalog.js';
const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const LAST_KEY = 'prism.last';
const DEFAULT_SOURCE = 'https://propee33f9c2.airspace-cdn.cbsivideo.com/index.m3u8';
const PROXY = 'https://iptv-stream-proxy.abetscrape.workers.dev';
const CHUNK = 200;

/* ---------------- utils ---------------- */
const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) loadedScripts.set(src, new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('load fail ' + src));
    document.head.appendChild(s);
  }));
  return loadedScripts.get(src);
}
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const CHIP_CSS = `.abet-chip-perspective{perspective:620px;width:56px;height:56px}.abet-chip-spinner{width:100%;height:100%;position:relative;transform-style:preserve-3d;animation:abet-chip-flip 2.4s cubic-bezier(.45,.05,.35,1) infinite}.abet-chip-face{position:absolute;inset:0;border-radius:50%;background:#0b0f17;display:flex;align-items:center;justify-content:center;backface-visibility:hidden}.abet-chip-seg{position:absolute;left:50%;top:4px;width:9px;height:15px;margin-left:-4.5px;border-radius:3px;background:rgba(253,181,21,0.85)}.abet-chip-txt{font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:1px;color:#FDB515;text-shadow:0 0 8px rgba(253,181,21,.65)}.abet-chip-back{transform:rotateY(180deg)}@keyframes abet-chip-flip{0%{transform:rotateY(0deg) translateY(0)}45%{transform:rotateY(540deg) translateY(-10px)}70%{transform:rotateY(720deg) translateY(0)}78%{transform:rotateY(720deg) translateY(-4px)}100%{transform:rotateY(1080deg) translateY(0)}}`;
let _chipCssDone = false;
const chipHTML = () => {
  const css = _chipCssDone ? '' : `<style>${CHIP_CSS}</style>`;
  _chipCssDone = true;
  const segs = Array.from({length:8},(_,o)=>`<span class="abet-chip-seg" style="transform:rotate(${o*45}deg)"></span>`).join('');
  return `${css}<div class="abet-chip-loader" role="status" aria-live="polite"><div class="abet-chip-perspective"><div class="abet-chip-spinner"><div class="abet-chip-face">${segs}<span class="abet-chip-txt">ABET</span></div><div class="abet-chip-face abet-chip-back">${segs}<span class="abet-chip-txt">ABET</span></div></div></div></div>`;
};
const proxied = url => `${PROXY}?u=${encodeURIComponent(url)}`;
function rawOf(u) {
  try {
    if (typeof u === 'string' && u.startsWith(PROXY + '?u='))
      return decodeURIComponent(new URL(u).searchParams.get('u') || '');
  } catch {}
  return u;
}
function getLast() { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || null; } catch { return null; } }
function setLast(url, name) { try { localStorage.setItem(LAST_KEY, JSON.stringify({ url, name: name || '', t: Date.now() })); } catch {} }

let toastEl = null;
function toast(msg) {
  if (!toastEl) { toastEl = el('div', 'toast'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._h);
  toastEl._h = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* logos */
const logoMap = new Map();
let logosRequested = false;
function requestLogos(rerenderRows) {
  if (logosRequested) return;
  logosRequested = true;
  setTimeout(async () => {
    try {
      const r = await fetch('/logos.json');
      if (r.ok) {
        for (const [id, url] of Object.entries(await r.json())) logoMap.set(id, url);
        rerenderRows?.();
      }
    } catch {}
  }, 1200);
}
const logoFor = id => logoMap.get(id) || '';
const flagFor = cc => cc?.length === 2 ? `https://flagcdn.com/w40/${cc.toLowerCase()}.png` : '';

/* ================= player ================= */
export function createPlayer({ stage }) {
  const shell = el('div', 'player-shell');
  shell.innerHTML = `
    <video controls playsinline preload="metadata"></video>
    <div class="player-loading">${chipHTML()}</div>
    <div class="player-err"></div>`;
  stage.appendChild(shell);

  const video = shell.querySelector('video');
  const errEl = shell.querySelector('.player-err');
  const loading = shell.querySelector('.player-loading');

  let engine = null, objectUrl = null;

  const fail = m => { errEl.textContent = m; errEl.classList.add('show'); toast(m); loading.style.display = 'none'; };
  video.addEventListener('waiting', () => { loading.style.display = ''; });
  video.addEventListener('playing', () => { loading.style.display = 'none'; });
  video.addEventListener('canplay', () => { loading.style.display = 'none'; });

  function attemptPlay() {
    const p = video.play();
    if (!p) return;
    p.catch(err => {
      if (err && err.name === 'NotAllowedError') {
        video.muted = true;
        video.play().then(() => showMuteBadge(shell)).catch(() => {});
      }
    });
  }

  function teardown() {
    if (engine?.destroy) try { engine.destroy(); } catch {}
    if (engine?.reset) try { engine.reset(); } catch {}
    engine = null; video.removeAttribute('src'); video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function load(src, opts = {}) {
    errEl.classList.remove('show'); teardown();
    let kind = opts.kind, target = src;
    if (!opts.isFile && typeof src === 'string') {
      kind = kind || (/\.mpd($|\?)/i.test(src) ? 'dash' : (/\.m3u8($|\?)/i.test(src) ? 'hls' : 'native'));
      target = proxied(src);
    } else if (opts.isFile) {
      objectUrl = URL.createObjectURL(src);
      target = objectUrl;
    }
    loading.style.display = '';
    try {
      if (kind === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) { video.src = target; }
        else {
          await loadScript(CDN.hls);
          if (!window.Hls?.isSupported()) { video.src = target; }
          else {
            engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
            engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`stream error (${d.details})`); });
            engine.loadSource(target); engine.attachMedia(video);
          }
        }
      } else if (kind === 'dash') {
        await loadScript(CDN.dash);
        engine = window.dashjs.MediaPlayer().create();
        engine.initialize(video, target, true);
      } else { video.src = target; }
      attemptPlay();
    } catch (e) { fail(e.message || String(e)); }
  }

  return {
    video,
    playChannel(ch) {
      const url = pickStream(ch.id);
      if (!url) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
      setLast(url, ch.name);
      document.title = `${ch.name} · prism`;
      load(url);
    },
    playUrl(url, name) {
      setLast(url, name || '');
      load(url);
    },
  };
}

function showMuteBadge(shell) {
  if (shell.querySelector('.mute-badge')) return;
  const b = el('button', 'mute-badge', '🔇 TAP FOR SOUND');
  b.addEventListener('click', e => {
    e.stopPropagation();
    const v = shell.querySelector('video');
    if (v) { v.muted = false; v.volume = Math.max(v.volume, .8); }
    b.remove();
  });
  shell.appendChild(b);
}

/* ================= bootstrap ================= */
export function mountPrism({ target, title = 'prism', defaultSource = DEFAULT_SOURCE } = {}) {
  document.title = title;

  /* ---------- player ---------- */
  const stage = el('div', 'stage');
  target.appendChild(stage);
  const player = createPlayer({ stage });

  /* ---------- collapsible section ---------- */
  const section = el('div', 'collapse-section');
  section.innerHTML = `
    <button class="collapse-header" id="secHeader">
      <span class="collapse-chevron" id="secChev">▸</span>
      <span class="collapse-title">CHANNELS</span>
      <span class="collapse-count" id="chCount"></span>
    </button>
    <div class="collapse-body" id="collapseBody">
      <div class="pill-bar" id="pillBar"></div>
      <div class="ch-list" id="chList"></div>
      <div class="list-more-wrap"><button class="list-more" id="listMore">SHOW MORE</button></div>
    </div>`;
  target.appendChild(section);

  /* ---------- refs / state ---------- */
  const pillBar = section.querySelector('#pillBar');
  const chList = section.querySelector('#chList');
  const listMoreWrap = section.querySelector('.list-more-wrap');
  const listMoreBtn = section.querySelector('#listMore');
  const chevEl = section.querySelector('#secChev');
  const countEl = section.querySelector('#chCount');
  const body = section.querySelector('#collapseBody');

  let ALL = [];
  let CUR = [];
  let rendered = 0;
  let activeCat = 'all';
  let workingOnly = false;
  let country = 'all';
  let open = false;

  /* ---------- collapse toggle ---------- */
  function setOpen(v) {
    open = v;
    body.style.display = open ? '' : 'none';
    chevEl.textContent = open ? '▾' : '▸';
    section.classList.toggle('open', open);
    if (open) appendChunk();
  }
  section.querySelector('#secHeader').addEventListener('click', () => setOpen(!open));

  /* ---------- country dropdown: opened as a fixed-position overlay ----------
     Kept outside renderPills() so exactly ONE of each listener exists for the
     lifetime of the page, and so the open menu survives a re-render.        */
  let openDropdown = null;

  function closeCountryDropdown() {
    if (!openDropdown) return;
    openDropdown.classList.remove('open');
    openDropdown = null;
  }

  function openCountryDropdown(btn, menu) {
    const r = btn.getBoundingClientRect();
    // position:fixed is viewport-relative, so the rect needs no scroll offset.
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(r.left)}px`;
    menu.classList.add('open');
    openDropdown = menu;
    // Clamp back inside the viewport if opening near the right edge.
    const m = menu.getBoundingClientRect();
    if (m.right > window.innerWidth - 8) {
      menu.style.left = `${Math.round(window.innerWidth - m.width - 8)}px`;
    }
  }

  // Registered once. Capture phase so it still fires when a child stops
  // propagation, and it must not fight the button's own toggle.
  document.addEventListener('click', (e) => {
    if (!openDropdown) return;
    if (openDropdown.contains(e.target)) return;
    if (e.target.closest?.('.pill-country')) return;
    closeCountryDropdown();
  });
  // A fixed menu does not follow its anchor, so dismiss on scroll/resize
  // rather than leave it stranded mid-page.
  window.addEventListener('scroll', closeCountryDropdown, true);
  window.addEventListener('resize', closeCountryDropdown);

  /* ---------- unified pill bar: working toggle + countries + categories ---------- */
  function renderPills() {
    pillBar.replaceChildren();

    // WORKING toggle — WORKING stacked ON TOP OF ONLY.
    //
    // Wrapping cannot do this. Earlier attempts set white-space:normal plus
    // height:18px and neither took effect:
    //   * .cat-pill declares min-height:36px, and min-height ALWAYS beats
    //     height, so the button stayed 36px tall;
    //   * nothing constrained the width, and a flex item with flex-shrink:0
    //     sizes to its content, so the text had no reason to wrap.
    // Two explicit lines in a column flex container stack regardless of width,
    // font size, or what the shared .cat-pill rule does.
    const workPill = el('button',
      'cat-pill pill-work pill-stack' + (workingOnly ? ' on' : ''),
      '<span>WORKING</span><span>ONLY</span>');
    workPill.addEventListener('click', () => {
      workingOnly = !workingOnly;
      renderPills(); rerenderList();
    });
    pillBar.appendChild(workPill);

    // separator
    pillBar.appendChild(el('span', 'pill-sep'));

    // top countries (by channel count) — DROPDOWN
    const cc = new Map();
    for (const c of ALL) {
      if (c.country?.length === 2) cc.set(c.country, (cc.get(c.country) || 0) + 1);
    }
    const topCC = [...cc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    // country dropdown button
    const countryBtn = el('button',
      'cat-pill pill-country' + (country !== 'all' ? ' on' : ''),
      country === 'all' ? '🌍 COUNTRY' : `${country.toUpperCase()} (${topCC.find(c => c[0] === country)?.[1] || 0})`);
    countryBtn.style.whiteSpace = 'nowrap';
    countryBtn.style.fontSize = '10px';
    countryBtn.style.lineHeight = '1.2';
    countryBtn.style.width = 'auto';
    countryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !dropdown.classList.contains('open');
      closeCountryDropdown();
      if (opening) openCountryDropdown(countryBtn, dropdown);
    });
    pillBar.appendChild(countryBtn);

    // THE DROPDOWN MUST NOT LIVE INSIDE .pill-bar.
    //
    // .pill-bar is `overflow-x: auto`, which establishes a clipping context —
    // and per spec, when one axis is `auto` the other computes to `auto` too,
    // so vertical overflow is clipped as well. A child at `top: 100%` renders
    // outside the content box and is clipped away entirely; it never appeared.
    // Adding `position: relative` to the scroll container made it worse, since
    // the menu then scrolled horizontally with the pills.
    //
    // Appending to <body> with position:fixed escapes every overflow, scroll
    // and transform ancestor. Coordinates come from the button's own rect at
    // open time, so it tracks the pill wherever the bar happens to be scrolled.
    closeCountryDropdown();
    document.querySelectorAll('body > .country-dropdown').forEach(n => n.remove());
    const dropdown = el('div', 'country-dropdown');
    document.body.appendChild(dropdown);
    // ALL option
    const allOpt = el('div', 'country-dropdown-item',
      `🌍 ALL (${ALL.length})`);
    allOpt.addEventListener('click', () => { closeCountryDropdown(); country = 'all'; renderPills(); rerenderList(); });
    dropdown.appendChild(allOpt);
    // top countries
    for (const [code, n] of topCC) {
      const opt = el('div', 'country-dropdown-item',
        `${code.toUpperCase()} (${n})`);
      opt.addEventListener('click', () => { closeCountryDropdown(); country = code; renderPills(); rerenderList(); });
      dropdown.appendChild(opt);
    }
    // Click-outside is registered ONCE at module level (see closeCountryDropdown
    // below), not here. renderPills() runs from eight call sites, so a listener
    // added here accumulated one stale closure per filter change.

    // separator
    pillBar.appendChild(el('span', 'pill-sep'));

    // categories
    const cats = getActiveCats();
    addPill(pillBar, 'all-cat', 'ALL CATS', activeCat === 'all', () => { activeCat = 'all'; renderPills(); rerenderList(); });
    const CAT_ORDER = ['sports', 'news', 'movies', 'kids', 'music', 'entertainment', 'documentary', 'series', 'general'];
    for (const cat of CAT_ORDER) {
      if (!cats.includes(cat)) continue;
      addPill(pillBar, cat, cat.toUpperCase(), activeCat === cat,
        () => { activeCat = activeCat === cat ? 'all' : cat; renderPills(); rerenderList(); });
    }
    for (const cat of cats) {
      if (CAT_ORDER.includes(cat)) continue;
      addPill(pillBar, cat, cat.toUpperCase(), activeCat === cat,
        () => { activeCat = activeCat === cat ? 'all' : cat; renderPills(); rerenderList(); });
    }
  }

  function addPill(bar, _val, label, on, onClick) {
    const b = el('button', 'cat-pill' + (on ? ' on' : ''), esc(label));
    b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    bar.appendChild(b);
  }

  function getActiveCats() {
    const set = new Set();
    for (const c of db.channels)
      for (const k of (c.categories || []))
        set.add(k.toLowerCase());
    return [...set];
  }

  /* ---------- channel rendering ---------- */
  function currentList() {
    let out = ALL;
    if (workingOnly) out = out.filter(c => hasStream(c.id) && getStatus(c.id) === 'working');
    if (country !== 'all') out = out.filter(c => c.country === country);
    if (activeCat !== 'all')
      out = out.filter(c => (c.categories || []).map(x => x.toLowerCase()).includes(activeCat));
    return out;
  }

  function rowFor(ch) {
    const st = getStatus(ch.id);
    const stream = hasStream(ch.id);
    const b = el('button', 'ch-row' + (stream ? '' : ' nostream'));
    b.dataset.id = ch.id;
    const logo = logoFor(ch.id);
    const flag = flagFor(ch.country); // always show country flag
    b.innerHTML = `
      <span class="dot ${st}${stream ? '' : ' none'}"></span>
      ${logo ? `<img class="ch-logo" loading="lazy" src="${esc(logo)}" alt="">`
             : `<span class="ch-initial">${esc((ch.name || '?')[0].toUpperCase())}</span>`}
      ${flag ? `<img class="ch-flag" loading="lazy" src="${esc(flag)}" alt="">` : ''}
      <span class="ch-name">${esc(ch.name)}</span>
      ${ch.country ? `<span class="ch-cc">${esc(ch.country.toUpperCase())}</span>` : ''}`;
    b.title = ch.name;
    b.addEventListener('click', () => {
      if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
      player.playChannel(ch);
    });
    return b;
  }

  function rerenderList() {
    CUR = currentList();
    rendered = 0;
    chList.replaceChildren();
    countEl.textContent = `${CUR.length.toLocaleString()}`;
    appendChunk();
  }

  function appendChunk() {
    if (rendered >= CUR.length) { listMoreWrap.style.display = 'none'; return; }
    const frag = document.createDocumentFragment();
    const end = Math.min(rendered + CHUNK, CUR.length);
    for (let i = rendered; i < end; i++) frag.appendChild(rowFor(CUR[i]));
    rendered = end;
    chList.appendChild(frag);
    listMoreWrap.style.display = rendered >= CUR.length ? 'none' : '';
    countEl.textContent = `${CUR.length.toLocaleString()} · showing ${rendered.toLocaleString()}`;
  }
  listMoreBtn.addEventListener('click', appendChunk);

  /* IntersectionObserver for auto-chunk */
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) appendChunk();
  }, { rootMargin: '800px' });
  const sentinel = el('div', 'list-sentinel');

  /* ---------- boot ---------- */
  const qp = new URLSearchParams(location.search).get('src');
  const last = getLast();
  const bootUrl = qp || rawOf(last?.url) || defaultSource;
  player.playUrl(bootUrl, last?.name);

  (async () => {
    try {
      await loadCatalog(m => {
        countEl.textContent = m || 'loading…';
        chList.replaceChildren(el('div', 'list-boot', `${chipHTML()}<div>${esc(m || 'loading…')}</div></div>`));
      });
      ALL = [...db.channels].sort((a, b) =>
        ((hasStream(b.id) ? 0 : 1) - (hasStream(a.id) ? 0 : 1)) ||
        (a.rank - b.rank) || a.name.localeCompare(b.name));
      renderPills();
      rerenderList();
      requestLogos(() => refreshLogos());
      list.appendChild(sentinel);
      io.observe(sentinel);
    } catch (e) {
      countEl.textContent = 'catalog offline';
      chList.innerHTML = `<div class="tree-empty">⚠ ${e.message}</div>`;
    }
  })();

  function refreshLogos() {
    chList.querySelectorAll('.ch-row[data-id]').forEach(row => {
      const url = logoFor(row.dataset.id);
      if (url && !row.querySelector('.ch-logo')) {
        const img = el('img', 'ch-logo'); img.loading = 'lazy'; img.alt = '';
        img.addEventListener('error', () => img.replaceWith(document.createTextNode('')), { once: true });
        img.src = url;
        row.insertBefore(img, row.querySelector('.ch-name'));
      }
    });
  }

  return { player };
}
