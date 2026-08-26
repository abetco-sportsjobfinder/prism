/* ============================================================
   PRISM guide module (GUIDE-UX-A1)
   Owns guide state, filtering, sorting, incremental rendering,
   counts, empty/reset UX. Pure helpers are exported for Node
   contract tests; the controller binds controls and renders.
   Catalog access is injected — nothing here fetches.
   Max 80 lines per function (contract).
   ============================================================ */

export const GUIDE_LIMITS = Object.freeze({ AZ_LIMIT: 250, CAT_INITIAL: 24, CAT_STEP: 24 });
const AZ_LIMIT = GUIDE_LIMITS.AZ_LIMIT;
const CAT_INITIAL = GUIDE_LIMITS.CAT_INITIAL;
const CAT_STEP = GUIDE_LIMITS.CAT_STEP;
const ROW_ORDER = ['sports', 'news', 'movies', 'kids', 'music',
  'entertainment', 'documentary', 'series', 'general'];

/* ---------------- pure: query ---------------- */
export function normalizeQuery(q) {
  return String(q ?? '').trim().toLowerCase();
}

/* ---------------- pure: filtering (no mutation) ---------------- */
export function filterChannels(channels, filters) {
  const { q = '', country = 'all', workingOnly = false } = filters || {};
  const needle = normalizeQuery(q);
  const out = [];
  for (const c of channels) {
    if (country !== 'all' && c.country !== country) continue;
    if (workingOnly && !(c.hasStream && c.isWorking)) continue;
    if (needle && !String(c.name || '').toLowerCase().includes(needle)) continue;
    out.push(c);
  }
  return out;
}

/* ---------------- pure: sorts / groups ---------------- */
export function sortAZ(list) {
  return [...list].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || '')));
}
function catPriority(key) {
  const i = ROW_ORDER.indexOf(key);
  return i >= 0 ? i : 99;
}
export function sortCategoryGroups(groups) {
  return [...groups].sort((a, b) =>
    (catPriority(a.key) - catPriority(b.key)) ||
    (b.count - a.count) || a.key.localeCompare(b.key));
}
export function groupByCategory(channels) {
  const map = new Map();
  for (const c of channels) {
    const cats = Array.isArray(c.categories)
      ? c.categories.map(k => String(k || '').toLowerCase()).filter(Boolean)
      : [];
    for (const k of (cats.length ? cats.slice(0, 2) : ['general'])) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
  }
  return sortCategoryGroups([...map.entries()]
    .map(([key, chans]) => ({ key, count: chans.length, channels: chans })));
}

/* ---------------- pure: paging / counts / labels ---------------- */
export function azPage(sorted, offset, limit = AZ_LIMIT) {
  const items = sorted.slice(offset, offset + limit);
  return { items, rendered: Math.min(offset + items.length, sorted.length), matched: sorted.length };
}
export function computeCounts(matched, rendered) {
  return { matched, rendered };
}
export function activeFilterLabels(f) {
  const labels = [];
  if (normalizeQuery(f.q)) labels.push(`search “${String(f.q).trim()}”`);
  if (f.country && f.country !== 'all') labels.push(`country ${String(f.country).toUpperCase()}`);
  if (f.workingOnly) labels.push('WORKING only');
  return labels;
}
export function shouldShowEmpty(matched) { return matched === 0; }

/* ---------------- A-Z pager ---------------- */
export class AzPager {
  constructor(sorted, deps = {}) {
    this.deps = deps;
    this.limit = deps.limit || AZ_LIMIT;
    this.reset(sorted);
  }
  reset(sorted) {
    this.list = sorted;
    this.offset = 0;
    this.rendered = 0;
    this.epoch = (this.epoch || 0) + 1;
    if (this._timer) { this.deps.clearTimer?.(this._timer); this._timer = null; }
  }
  next() {
    const page = azPage(this.list, this.offset, this.limit);
    this.offset += page.items.length;
    this.rendered = page.rendered;
    return page;
  }
  get exhausted() { return this.rendered >= this.list.length; }
}

export function scheduleChunk(timerFns, state, delay, fn) {
  state.timer = timerFns.setTimeout(() => {
    state.timer = null;
    if (state.epoch === state.runEpoch) fn();
  }, delay);
}
export function cancelChunk(timerFns, state) {
  if (state.timer) { timerFns.clearTimeout(state.timer); state.timer = null; }
  state.epoch++;
}

/* ---------------- local helpers ---------------- */
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = escHtml;
const escapeText = escHtml;
function el(t, c, h) {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (h != null) e.innerHTML = h;
  return e;
}
function injectStyles() {
  if (document.getElementById('prism-guide-css')) return;
  const l = document.createElement('link');
  l.id = 'prism-guide-css';
  l.rel = 'stylesheet';
  l.href = '/assets/prism-guide.css';
  document.head.appendChild(l);
}

/* ================= view builders (module scope, ctx-injected) ================= */
function makeRow(ctx, ch) {
  const b = el('button', 'ch-row' + (ch.hasStream ? '' : ' nostream'));
  b.dataset.id = ch.id;
  const logo = ctx.logos.for?.(ch.id) || '';
  const flag = !logo ? (ctx.logos.flag?.(ch.country) || '') : '';
  b.innerHTML = `
    <span class="dot ${ch.isWorking ? 'working' : 'unknown'}${ch.hasStream ? '' : ' none'}"></span>
    ${logo ? `<img class="ch-logo" loading="lazy" src="${escAttr(logo)}" alt="">`
           : flag ? `<img class="ch-flag" loading="lazy" src="${escAttr(flag)}" alt="">` : ''}
    <span class="ch-name">${escHtml(ch.name)}</span>
    ${ch.country ? `<span class="ch-cc">${escHtml(ch.country.toUpperCase())}</span>` : ''}
    <span class="ch-actions">
      <button class="row-new" title="Open in NEW player">＋</button>
      <button class="fav-star${ctx.favs.has(ch.id) ? ' on' : ''}" title="Favorite">★</button>
    </span>`;
  b.title = ch.name + (ch.hasStream ? '' : ' · no stream');
  b.addEventListener('click', e => {
    if (e.target.closest('.fav-star')) { ctx.onToggleFav(ch.id); ctx.refresh(); return; }
    if (e.target.closest('.row-new')) { ctx.onPlayNew(ch); ctx.closeDrawer(); return; }
    if (!ch.hasStream) return;
    ctx.onPlay(ch); ctx.closeDrawer();
  });
  return b;
}

function makeCard(ctx, ch) {
  const card = el('button', 'gcard' + (ch.hasStream ? '' : ' dead'));
  const logo = ctx.logos.for?.(ch.id) || ctx.logos.flag?.(ch.country) || '';
  card.innerHTML = `
    <span class="gcard-media">${logo
      ? `<img loading="lazy" src="${escAttr(logo)}" alt="">`
      : escHtml((ch.name || '?')[0].toUpperCase())}</span>
    <span class="gcard-name">${escHtml(ch.name)}</span>
    <span class="dot ${ch.isWorking ? 'working' : ch.hasStream ? 'unknown' : 'none'}"></span>`;
  card.title = ch.name;
  card.addEventListener('click', () => {
    if (!ch.hasStream) return;
    ctx.onPlay(ch); ctx.closeDrawer();
  });
  return card;
}

function renderAzView(azWrap, ctx) {
  const base = sortAZ(ctx.filtered());
  const pager = new AzPager(base, { makeRow: ch => makeRow(ctx, ch), limit: AZ_LIMIT });
  const page = pager.next();

  const frag = document.createDocumentFragment();
  for (const ch of page.items) frag.appendChild(makeRow(ctx, ch));
  azWrap.replaceChildren(frag);

  if (shouldShowEmpty(page.matched)) return renderEmptyView(azWrap, ctx);

  const more = el('button', 'guide-more',
    `SHOW MORE (${(page.matched - page.rendered).toLocaleString()} hidden by performance cap)`);
  more.addEventListener('click', () => {
    const nxt = pager.next();
    const f2 = document.createDocumentFragment();
    for (const ch of nxt.items) f2.appendChild(makeRow(ctx, ch));
    azWrap.insertBefore(f2, more);
    ctx.setCounts(nxt.matched, nxt.rendered);
    if (pager.exhausted) { more.remove(); return; }
    more.textContent =
      `SHOW MORE (${(nxt.matched - nxt.rendered).toLocaleString()} hidden by performance cap)`;
  });
  if (!pager.exhausted) azWrap.appendChild(more);
  ctx.setCounts(page.matched, page.rendered);
}

function categoryShell(ctx, g) {
  const row = el('div', 'guide-row');
  row.appendChild(el('div', 'guide-row-title',
    `${escapeText(g.key.toUpperCase())} <span class="count">${g.count.toLocaleString()}</span>`));
  const strip = el('div', 'guide-cards');
  let shown = 0;
  const revealBtn = el('button', 'guide-more-sm');
  const reveal = () => {
    const slice = g.channels.slice(shown, shown + CAT_STEP);
    for (const ch of slice) strip.appendChild(makeCard(ctx, ch));
    shown += slice.length;
    ctx.bumpRendered(slice.length);
    if (shown >= g.channels.length) { revealBtn.remove(); return; }
    revealBtn.textContent = `+${Math.min(CAT_STEP, g.channels.length - shown)}`;
  };
  const first = g.channels.slice(0, CAT_INITIAL);
  for (const ch of first) strip.appendChild(makeCard(ctx, ch));
  shown = first.length;
  revealBtn.textContent = `+${Math.min(CAT_STEP, g.channels.length - shown)}`;
  revealBtn.addEventListener('click', reveal);
  if (g.channels.length > shown) strip.appendChild(revealBtn);
  row.appendChild(strip);
  return row;
}

function renderCategoryView(catWrap, ctx) {
  const groups = groupByCategory(ctx.filtered());
  let matched = 0, renderedRows = 0;
  catWrap.replaceChildren();
  for (const g of groups) {
    matched += g.count;
    const row = el('div', 'guide-row');
    row.appendChild(el('div', 'guide-row-title',
      `${escapeText(g.key.toUpperCase())} <span class="count">${g.count.toLocaleString()}</span>`));
    const strip = el('div', 'guide-cards');
    const first = g.channels.slice(0, CAT_INITIAL);
    for (const ch of first) strip.appendChild(makeCard(ctx, ch));
    renderedRows += first.length;
    let shown = first.length;
    const revealBtn = el('button', 'guide-more-sm');
    const reveal = () => {
      const slice = g.channels.slice(shown, shown + CAT_STEP);
      for (const ch of slice) strip.appendChild(makeCard(ctx, ch));
      shown += slice.length;
      renderedRows += slice.length;
      ctx.setCounts(matched, renderedRows);
      if (shown >= g.channels.length) { revealBtn.remove(); return; }
      revealBtn.textContent = `+${Math.min(CAT_STEP, g.channels.length - shown)}`;
    };
    revealBtn.textContent = `+${Math.min(CAT_STEP, g.channels.length - shown)}`;
    revealBtn.addEventListener('click', reveal);
    if (g.channels.length > shown) strip.appendChild(revealBtn);
    row.appendChild(strip);
    catWrap.appendChild(row);
  }
  if (!catWrap.children.length)
    catWrap.appendChild(el('div', 'tree-empty', 'No categorized channels match.'));
  ctx.setCounts(matched, renderedRows);
}

function renderEmptyView(container, ctx) {
  container.replaceChildren();
  const labels = activeFilterLabels(ctx.filters());
  const box = el('div', 'guide-empty');
  box.innerHTML = `
    <div class="empty-title">No channels match.</div>
    <div class="empty-filters">Active: ${labels.length ? escapeText(labels.join(', ')) : 'none'}</div>`;
  const reset = el('button', 'guide-reset', 'RESET FILTERS');
  reset.addEventListener('click', () => ctx.resetFilters());
  box.appendChild(reset);
  container.appendChild(box);
  ctx.setCounts(0, 0);
}

/* ================= controller ================= */
export function createGuide(deps) {
  const {
    host, controls,
    data, logos = {}, favs = new Set(),
    onPlay = () => {}, onPlayNew = () => {},
    onToggleFav = () => {}, setDrawerClosed = () => {},
  } = deps;

  injectStyles();

  const searchRow = el('div', 'guide-search-row',
    `<input class="url-input guide-search" type="search"
        placeholder="⌕ search channels…" spellcheck="false" autocomplete="off" />
     <span class="guide-counts" role="status"></span>`);
  host.prepend(searchRow);
  const searchEl = searchRow.querySelector('.guide-search');
  const countsEl = searchRow.querySelector('.guide-counts');

  const drawerBody = el('div', 'drawer-body');
  host.appendChild(drawerBody);

  const state = {
    q: '', country: 'all', workingOnly: true, sortMode: 'category',
    matched: 0, renderedRows: 0,
  };
  let drawerOpen = false;

  function filteredRaw() {
    let out = data.getChannels();
    if (country !== 'all') out = out.filter(c => c.country === country);
    return out;
  }

  const ctx = {
    favs, logos,
    filters: () => ({ q: state.q, country: state.country, workingOnly: state.workingOnly }),
    filtered: () => filterChannels(filteredRaw(), {
      q: state.q, country: state.country,
      workingOnly: workingOnly && state.sortMode === 'az',
    }),
    setCounts: (m, r) => {
      state.matched = m; state.renderedRows = r;
      countsEl.innerHTML =
        `<b>${m.toLocaleString()}</b> MATCHED · ${r.toLocaleString()} RENDERED`;
    },
    bumpRendered: n => { state.renderedRows += n; },
    resetFilters: () => {
      state.q = ''; searchEl.value = '';
      country = 'all'; controls.countrySel.value = 'all';
      state.workingOnly = true; controls.workChk.checked = true;
      rerender();
    },
    refresh: () => rerender(),
    onPlay: ch => playFocused(ch),
    onPlayNew: ch => playNewWindow(ch),
    onToggleFav: toggleFav,
    closeDrawer: () => setDrawer(false),
  };

  function renderCurrent() {
    if (state.sortMode === 'category')
      renderCategoryView(drawerBody, ctx);
    else
      renderAzView(drawerBody, ctx);
  }
  function rerender() { renderCurrent(); updateMeta(); }

  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    saveFavs(favs);
    rerender();
  }
  function saveFavs(set) { try { localStorage.setItem('prism.favs', JSON.stringify([...set])); } catch {} }

  function playFocused(ch) {
    const url = pickStreamProxy(ch);
    if (!url) return;
    deps.onPlay({ ...ch, url });
    setDrawer(false);
  }
  function playNewWindow(ch) {
    const url = pickStreamProxy(ch);
    if (!url) return;
    deps.onPlayNew({ ...ch, url });
    setDrawer(false);
  }
  function pickStreamProxy(ch) {
    const url = deps.pickStream(ch.id);
    if (!url) toastLocal(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`);
    return url;
  }
  function toastLocal(msg) {
    document.dispatchEvent(new CustomEvent('prism:toast', { detail: { msg } }));
  }

  function setDrawer(open) {
    drawerOpen = open;
    document.dispatchEvent(new CustomEvent('prism:drawer', { detail: { open } }));
  }

  /* control bindings (binding isolated from fetch/filter/render) */
  let qT;
  searchEl.addEventListener('input', () => {
    clearTimeout(qT);
    qT = setTimeout(() => { state.q = searchEl.value; rerender(); }, 200);
  });
  controls.workChk.addEventListener('change', e => {
    state.workingOnly = e.target.checked; rerender();
  });
  controls.sortSel.addEventListener('change', e => {
    state.sortMode = e.target.value; rerender();
  });
  controls.countrySel.addEventListener('change', e => {
    country = e.target.value; rerender();
  });

  function initCountries() {
    for (const [code, n] of data.getCountries()) {
      controls.countrySel.insertAdjacentHTML('beforeend',
        `<option value="${escAttr(code)}">${escHtml(code.toUpperCase())} (${n.toLocaleString()})</option>`);
    }
  }

  return {
    initCountries,
    rerender,
    hasContent: () => !!(drawerBody.children.length),
    get isOpen() { return drawerOpen; },
    setSort(m) { state.sortMode = m; controls.sortSel.value = m; rerender(); },
    setCountry(c) { country = c; controls.countrySel.value = c; rerender(); },
    setWorking(v) { state.workingOnly = v; controls.workChk.checked = v; rerender(); },
    setSearch(q) { state.q = q; searchEl.value = q; rerender(); },
    counts: () => computeCounts(state.matched, state.renderedRows),
    searchEl,
    countsEl,
  };
}
