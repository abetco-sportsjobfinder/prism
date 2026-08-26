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
const chipHTML = '<span class="abet-chip-loader"><div class="abet-chip-perspective"><div class="abet-chip-spinner"><div class="abet-chip-face">' +
  Array.from({length:8},(_,o)=>`<span class="abet-chip-seg" style="transform:rotate(${o*45}deg)"></span>`).join('') +
  '<span class="abet-chip-txt">ABET</span></div><div class="abet-chip-face abet-chip-back">' +
  Array.from({length:8},(_,o)=>`<span class="abet-chip-seg" style="transform:rotate(${o*45}deg)"></span>`).join('') +
  '<span class="abet-chip-txt">ABET</span></div></div></div></div>';
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
    <div class="player-loading">${chipHTML}</div>
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
      <div class="filter-bar">
        <label class="f-work"><input type="checkbox" id="workChk" /> WORKING</label>
        <select id="countrySel" class="f-country"><option value="all">🌍 ALL</option></select>
      </div>
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
  let expanded = true;
  let activeCat = 'all';
  let workingOnly = false;
  let country = 'all';
  let open = false;

  /* ---------- refs for filters ---------- */
  const workChk = section.querySelector('#workChk');
  const countrySel = section.querySelector('#countrySel');

  /* ---------- collapse toggle ---------- */
  function setOpen(v) {
    open = v;
    body.style.display = open ? '' : 'none';
    chevEl.textContent = open ? '▾' : '▸';
    section.classList.toggle('open', open);
    if (open) appendChunk();
  }
  section.querySelector('#secHeader').addEventListener('click', () => setOpen(!open));

  workChk.addEventListener('change', () => { workingOnly = workChk.checked; rerenderList(); });
  countrySel.addEventListener('change', () => { country = countrySel.value; rerenderList(); });

  /* ---------- category pills ---------- */
  const CAT_ORDER = ['all', 'sports', 'news', 'movies', 'kids', 'music', 'entertainment', 'documentary', 'series', 'general'];
  function renderPills(cats) {
    pillBar.replaceChildren();
    // always start with ALL
    addPill(pillBar, 'all', 'ALL', cats.includes('all'));
    // then known categories in order
    for (const cat of CAT_ORDER.slice(1)) {
      if (cats.includes(cat)) addPill(pillBar, cat, cat.toUpperCase(), activeCat === cat);
    }
    // any remaining categories not in the priority list
    for (const cat of cats) {
      if (cat !== 'all' && !CAT_ORDER.includes(cat)) addPill(pillBar, cat, cat.toUpperCase(), false);
    }
  }
  function addPill(bar, value, label) {
    const b = el('button', 'cat-pill' + (activeCat === value ? ' on' : ''), esc(label));
    b.addEventListener('click', () => { activeCat = value; renderPills(getActiveCats()); rerenderList(); });
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
    if (activeCat !== 'all')
      out = out.filter(c => (c.categories || []).map(x => x.toLowerCase()).includes(activeCat));
    if (workingOnly) out = out.filter(c => hasStream(c.id) && getStatus(c.id) === 'working');
    if (country !== 'all') out = out.filter(c => c.country === country);
    return out;
  }

  function rowFor(ch) {
    const st = getStatus(ch.id);
    const stream = hasStream(ch.id);
    const b = el('button', 'ch-row' + (stream ? '' : ' nostream'));
    b.dataset.id = ch.id;
    const logo = logoFor(ch.id);
    const flag = !logo ? flagFor(ch.country) : '';
    b.innerHTML = `
      <span class="dot ${st}${stream ? '' : ' none'}"></span>
      ${logo ? `<img class="ch-logo" loading="lazy" src="${esc(logo)}" alt="">`
             : flag ? `<img class="ch-flag" loading="lazy" src="${flag}" alt="">` : ''}
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
        chList.replaceChildren(el('div', 'list-boot', `${chipHTML}<div>${esc(m || 'loading…')}</div>`));
      });
      ALL = [...db.channels].sort((a, b) =>
        ((hasStream(b.id) ? 0 : 1) - (hasStream(a.id) ? 0 : 1)) ||
        (a.rank - b.rank) || a.name.localeCompare(b.name));
      // populate country filter
      const cc = new Map();
      for (const c of ALL) {
        if (c.country?.length === 2) cc.set(c.country, (cc.get(c.country) || 0) + 1);
      }
      for (const [code, n] of [...cc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
        countrySel.insertAdjacentHTML('beforeend',
          `<option value="${esc(code)}">${esc(code.toUpperCase())} (${n.toLocaleString()})</option>`);
      }
      renderPills(getActiveCats());
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
