/* ============================================================
   PRISM — Piece R1. A player + a list of every channel.
   No filters, no search, no sort, no multi-player, no chrome.
   ============================================================ */

import { loadCatalog, db, countries, categories, getStatus, hasStream, pickStream } from './catalog.js';

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
/* the REAL sportsbook-jobs loader (DashboardClient.tsx:209) — ring + shimmer, verbatim values */
const chipHTML = '<span class="sb-ring"></span>';
const sbLoader = (label) => `<span class="sb-load">${chipHTML}<span class="sb-label">${esc(label)}</span><span class="sb-shimmer"><i></i></span></span>`;
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
function requestLogos(onReady) {
  if (logosRequested) return;
  logosRequested = true;
  setTimeout(async () => {
    try {
      const r = await fetch('/logos.json');
      if (r.ok) {
        for (const [id, url] of Object.entries(await r.json())) logoMap.set(id, url);
        onReady?.();
      }
    } catch {}
  }, 1500);
}
const logoFor = id => logoMap.get(id) || '';
const flagFor = cc => cc?.length === 2 ? `https://flagcdn.com/w40/${cc.toLowerCase()}.png` : '';

/* ================= the one player ================= */
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

  let engine = null, objectUrl = null, engineLabel = '';

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
        video.play().then(showMuteBadge).catch(() => {});
      }
    });
  }

  function showMuteBadge() {
    if (shell.querySelector('.mute-badge')) return;
    const b = el('button', 'mute-badge', '🔇 TAP FOR SOUND');
    b.addEventListener('click', e => {
      e.stopPropagation();
      video.muted = false; video.volume = Math.max(video.volume, .8);
      b.remove();
    });
    shell.appendChild(b);
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
        if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) { video.src = target; engineLabel = 'native-hls'; }
        else {
          await loadScript(CDN.hls);
          if (!window.Hls?.isSupported()) { video.src = target; engineLabel = 'native-hls'; }
          else {
            engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
            engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`stream error (${d.details})`); });
            engine.loadSource(target); engine.attachMedia(video); engineLabel = 'hls.js';
          }
        }
      } else if (kind === 'dash') {
        await loadScript(CDN.dash);
        engine = window.dashjs.MediaPlayer().create();
        engine.initialize(video, target, true);
        engineLabel = 'dash.js';
      } else { video.src = target; engineLabel = 'native'; }
      attemptPlay();
    } catch (e) { fail(e.message || String(e)); }
  }


  return {
    video,
    load,
    playChannel(ch) {
      const url = pickStream(ch.id);
      if (!url) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
      setLast(url, ch.name);
      document.title = `${ch.name} · prism`;
      load(url);
    },
  };
}

/* ================= every channel ================= */
function rowFor(ch, onPlay) {
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
  b.title = ch.name + (stream ? '' : ' · no stream');
  b.addEventListener('click', () => onPlay(ch));
  return b;
}



/* ================= bootstrap ================= */
export function mountPrism({ target, title = 'prism' } = {}) {
  document.title = title;

  const stage = el('div', 'stage');

  const bar = el('div', 'list-bar');
  const listStatus = el('span', null, sbLoader('LOADING EVERY CHANNEL…'));
  const workLbl = el('label', 'tree-working');
  workLbl.innerHTML = '<input type="checkbox" id="workChk" checked /> WORKING';
  const sortSel = el('select', 'sort-select');
  sortSel.innerHTML = '<option value="az" selected>A–Z</option><option value="category">CATEGORY</option>';
  const cSel = el('select', 'country-select');
  cSel.innerHTML = '<option value="all">🌍 ALL</option>';
  const minBtn = el('button', 'caret-btn', '<i class="fas fa-chevron-down"></i>');
  minBtn.title = 'Minimize / expand channel list';
  bar.append(listStatus, workLbl, sortSel, cSel, minBtn);

  const list = el('div', 'ch-list');
  target.append(stage, bar, list);

  const player = createPlayer({ stage });

  let ALL = [];
  let CUR = [];
  let rendered = 0;
  let minimized = false;
  let workingOnly = true;
  let sortMode = 'az';
  const sentinel = el('div', 'list-sentinel');
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) appendChunk();
  }, { rootMargin: '900px' });

  function filtered() {
    let out = ALL;
    if (cSel.value !== 'all') out = out.filter(c => c.country === cSel.value);
    if (workingOnly) out = out.filter(c => hasStream(c.id) && getStatus(c.id) === 'working');
    return sortMode === 'az'
      ? [...out].sort((a, b) => a.name.localeCompare(b.name))
      : [...out].sort((a, b) => {
          const ca = (a.categories || [])[0] || 'zzz', cb = (b.categories || [])[0] || 'zzz';
          return ca.localeCompare(cb) || a.name.localeCompare(b.name);
        });
  }

  function appendChunk() {
    if (minimized || sortMode !== 'az' || rendered >= CUR.length) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(rendered + CHUNK, CUR.length);
    for (let i = rendered; i < end; i++) frag.appendChild(rowFor(CUR[i], ch => player.playChannel(ch)));
    rendered = end;
    list.insertBefore(frag, sentinel);
    listStatus.textContent = `${CUR.length.toLocaleString()} CHANNELS · showing ${rendered.toLocaleString()} · scroll for more`;
  }

  function gcard(ch) {
    const st = getStatus(ch.id);
    const stream = hasStream(ch.id);
    const card = el('button', 'gcard' + (stream ? '' : ' dead'));
    const logo = logoFor(ch.id) || flagFor(ch.country);
    card.innerHTML = `
      <span class="gcard-media">${logo
        ? `<img loading="lazy" src="${esc(logo)}" onerror="this.replaceWith(document.createTextNode(''))" alt="">`
        : esc((ch.name || '?')[0].toUpperCase())}</span>
      <span class="gcard-name">${esc(ch.name)}</span>
      <span class="dot ${st}${stream ? '' : ' none'}"></span>`;
    card.title = ch.name;
    card.addEventListener('click', () => {
      if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 24)}`); return; }
      player.playChannel(ch);
    });
    return card;
  }

  function renderCategory() {
    list.querySelectorAll('.cat-wrap, .ch-row').forEach(n => n.remove());
    const wrap = el('div', 'cat-wrap');
    const byCat = new Map();
    for (const c of CUR) {
      const cats = (c.categories || []).filter(Boolean);
      for (const k of (cats.length ? cats.slice(0, 2) : ['general'])) {
        if (!byCat.has(k)) byCat.set(k, []);
        byCat.get(k).push(c);
      }
    }
    const order = ['sports', 'news', 'movies', 'kids', 'music', 'entertainment', 'documentary', 'series', 'general'];
    const entries = [...byCat.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return ((ia >= 0 ? ia : 99) - (ib >= 0 ? ib : 99)) || (b[1].length - a[1].length);
    });
    for (const [cat, chans] of entries) {
      const row = el('div', 'guide-row');
      row.appendChild(el('div', 'guide-row-title',
        `${esc(cat.toUpperCase())} <span class="count">${chans.length}</span>`));
      const strip = el('div', 'guide-cards');
      for (const ch of chans.slice(0, 24)) strip.appendChild(gcard(ch));
      row.appendChild(strip);
      wrap.appendChild(row);
    }
    if (!wrap.children.length)
      wrap.innerHTML = '<div class="tree-empty">No channels match.</div>';
    list.insertBefore(wrap, sentinel);
  }

  function refreshView() {
    CUR = filtered();
    rendered = 0;
    list.querySelectorAll('.ch-row, .cat-wrap').forEach(n => n.remove());
    if (minimized) { listStatus.textContent = `${CUR.length.toLocaleString()} CHANNELS`; return; }
    if (sortMode === 'category') { renderCategory(); listStatus.textContent = `${CUR.length.toLocaleString()} CHANNELS BY CATEGORY`; }
    else { io.observe(sentinel); appendChunk(); }
  }

  minBtn.addEventListener('click', () => {
    minimized = !minimized;
    list.classList.toggle('min', minimized);
    minBtn.querySelector('i').className =
      `fas fa-chevron-${minimized ? 'up' : 'down'}`;
    if (minimized) {
      io.disconnect();
      listStatus.textContent = `${CUR.length.toLocaleString()} CHANNELS`;
    } else {
      refreshView();
    }
  });
  cSel.addEventListener('change', refreshView);
  workLbl.querySelector('#workChk').addEventListener('change', e => {
    workingOnly = e.target.checked; refreshView();
  });
  sortSel.addEventListener('change', e => { sortMode = e.target.value; refreshView(); });

  (async () => {
    try {
      await loadCatalog(m => { listStatus.innerHTML = `${chipHTML} ${esc(m || 'loading…')}`; });
      ALL = [...db.channels].sort((a, b) =>
        ((hasStream(b.id) ? 0 : 1) - (hasStream(a.id) ? 0 : 1)) ||
        (a.rank - b.rank) || a.name.localeCompare(b.name));
      CUR = ALL;
      cSel.insertAdjacentHTML('beforeend',
        countries().slice(0, 60)
          .map(([code, n]) => `<option value="${code}">${code.toUpperCase()} (${n.toLocaleString()})</option>`).join(''));
      listStatus.textContent = '';
      list.appendChild(sentinel);
      refreshView();
      requestLogos(() => {
        refreshView();
        list.querySelectorAll('.ch-row[data-id]').forEach(row => {
          const url = logoFor(row.dataset.id);
          if (url && !row.querySelector('.ch-logo')) {
            const img = el('img', 'ch-logo'); img.loading = 'lazy'; img.alt = '';
            img.addEventListener('error', () => img.replaceWith(document.createTextNode('')), { once: true });
            img.src = url;
            row.insertBefore(img, row.querySelector('.ch-name'));
          }
        });
      });
    } catch (e) {
      listStatus.textContent = `⚠ catalog failed: ${e.message}`;
    }

    const qp = new URLSearchParams(location.search).get('src');
    const last = getLast();
    player.load(qp || rawOf(last?.url) || DEFAULT_SOURCE);
    if (!qp && last?.name) document.title = `${last.name} · prism`;
  })();

  return { player };
}
