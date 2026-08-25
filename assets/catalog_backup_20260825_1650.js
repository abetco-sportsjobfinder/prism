/* ============================================================
   PRISM catalog engine — brings back the ~10k-channel universe:
   iptv-org channels+streams, worker-verified working statuses,
   ranking, and query/filters for the hierarchy tree.
   ============================================================ */

const API = 'https://iptv-org.github.io/api';
export const PROXY = 'https://iptv-stream-proxy.abetscrape.workers.dev';

const WORKING_TTL = 7 * 864e5;
const DEAD_TTL = 3 * 864e5;

const GOOD_CDNS = ['cloudfront.net', 'akamaized.net', 'akamaihd.net', 'amagi.tv', 'wurl.tv', 'tubi.video', 'pb-', 'aegis-cloudfront', 'airspace-cdn', 'fastly.net', 'pluto.tv'];
const BAD_CDNS = ['jmp2.uk', 'messi.damitv.st'];

export const db = {
  channels: [],            // {id,name,country,categories[],source:'iptvorg',rank}
  byId: new Map(),
  streamsByChannel: new Map(),
  status: new Map(),       // id -> {status,time}
  totalIndexed: 0,         // every channel in iptv-org, incl. zero-stream ones
};

async function fetchT(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) return res;
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) { clearTimeout(t); lastErr = e; }
    await new Promise(r => setTimeout(r, 700 * (i + 1)));
  }
  throw lastErr || new Error('fetch failed');
}

/* Brand extraction (simplified from proven tree.js): ABC News Live 3 -> ABC NEWS LIVE */
const QUALIFIERS = new Set(['PLUS', 'EXTRA', 'HD', 'FHD', 'SD', 'UHD', '4K', '8K', 'EAST', 'WEST', 'NORTH', 'SOUTH', 'FEED']);
const NUMBERY = /^\+?\d+(\.\d+)?$/;
export function brandKey(name) {
  let s = String(name || '').toUpperCase()
    .replace(/[\u2019'`]/g, '')
    .replace(/\([^\)]*\)|\[[^\]]*\]|\{[^\}]*\}/g, ' ')
    .split(/[|•·–—:\/\\]/)[0]
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  let toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && (QUALIFIERS.has(toks.at(-1)) || NUMBERY.test(toks.at(-1)))) toks.pop();
  return toks.join(' ') || String(name || '?').toUpperCase().trim() || '?';
}

function mergeStatusMap(raw) {
  const now = Date.now();
  for (const [id, entry] of Object.entries(raw || {})) {
    if (!entry?.status || !entry?.time) continue;
    const age = now - entry.time;
    if (entry.status === 'working' && age > WORKING_TTL) continue;
    if (entry.status === 'dead' && age > DEAD_TTL) continue;
    const prev = db.status.get(id);
    if (!prev || (prev.time || 0) < entry.time) db.status.set(id, { status: entry.status, time: entry.time });
  }
}

export function getStatus(id) {
  const e = db.status.get(id);
  if (!e) return 'unknown';
  return e.status === 'dead' ? 'dead' : 'working';
}

/* Best playable URL for a channel (ranked like the v1 player) */
export function pickStream(id) {
  const all = db.streamsByChannel.get(id) || [];
  const clean = all.filter(s => /^https?:\/\//.test(s.url) &&
    !s.url.includes('youtube.com') && !/\.mpd(\?|$)/i.test(s.url) &&
    !BAD_CDNS.some(bad => s.url.includes(bad)));
  if (!clean.length) return null;
  const https = clean.filter(s => s.url.startsWith('https://'));
  const pool = https.length ? https : clean;
  const good = pool.filter(s => GOOD_CDNS.some(cdn => s.url.includes(cdn)));
  return (good[0] || pool[0]).url;
}

export function countries() {
  const m = new Map();
  for (const c of db.channels) {
    const cc = c.country;
    if (cc?.length === 2) m.set(cc, (m.get(cc) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function stats() {
  let working = 0;
  for (const c of db.channels) if (getStatus(c.id) === 'working') working++;
  return { total: db.channels.length, totalAll: db.totalIndexed, working };
}

/* query filters -> flat channel list */
export function query({ q = '', country = 'all', workingOnly = true } = {}) {
  const needle = q.trim().toLowerCase();
  return db.channels
    .filter(c =>
      (!needle || c.name.toLowerCase().includes(needle)) &&
      (country === 'all' || c.country === country) &&
      (!workingOnly || getStatus(c.id) === 'working'))
    .sort((a, b) => {
      const wa = getStatus(a.id) === 'working' ? 0 : 1;
      const wb = getStatus(b.id) === 'working' ? 0 : 1;
      return (wa - wb) || (a.rank - b.rank) || a.name.localeCompare(b.name);
    });
}

/* letter -> brand -> channels bracket */
export function hierarchy(channels) {
  const letters = new Map();
  for (const c of channels) {
    const bk = brandKey(c.name);
    const L = /^[A-Z]/.test(bk[0]) ? bk[0] : '#';
    if (!letters.has(L)) letters.set(L, new Map());
    const brands = letters.get(L);
    if (!brands.has(bk)) brands.set(bk, []);
    brands.get(bk).push(c);
  }
  for (const brands of letters.values())
    for (const list of brands.values())
      list.sort((a, b) => a.name.localeCompare(b.name));
  return letters;
}

/* main loader: onProgress(stage string) fires as it goes */
export async function loadCatalog(onProgress = () => {}) {
  onProgress('fetching channel index…');
  const [chRes, stRes] = await Promise.all([
    fetchT(`${API}/channels.json`),
    fetchT(`${API}/streams.json`),
  ]);
  onProgress('parsing catalog…');
  const [channelsData, streamsData] = [await chRes.json(), await stRes.json()];
  onProgress(`indexing ${streamsData.length.toLocaleString()} streams…`);
  db.totalIndexed = channelsData.length;

  const byId = new Map(channelsData.map(c => [c.id, {
    id: c.id, name: c.name, country: c.country || '',
    categories: c.categories || [], source: 'iptvorg',
  }]));

  for (const s of streamsData) {
    if (!s.url || !/^https?:\/\//.test(s.url)) continue;
    if (/youtube\.com|\.mpd(\?|$)/i.test(s.url)) continue;
    if (!db.streamsByChannel.has(s.channel)) db.streamsByChannel.set(s.channel, []);
    db.streamsByChannel.get(s.channel).push({ url: s.url });
  }

  onProgress('loading verified-working map…');
  /* global probe results: cron shortlist + every device's reported statuses.
     NOTE: the worker only echoes ACAO for allowlisted pages.dev origins —
     if both maps come back empty, suspect CORS before suspecting data. */
  const jobs = [
    fetch(`${PROXY}/shortlist`).then(r => r.ok ? r.json() : null).catch(e => { console.warn('[catalog] /shortlist blocked:', e.message); return null; }),
    fetch(`${PROXY}/api/status`).then(r => r.ok ? r.json() : null).catch(e => { console.warn('[catalog] /api/status blocked:', e.message); return null; }),
  ];
  const [shortlist, legacyStatus] = await Promise.all(jobs);
  if (shortlist?.channels) {
    for (const c of shortlist.channels) {
      if (c.id && c.checked) db.status.set(c.id, { status: 'working', time: c.checked });
    }
  }
  mergeStatusMap(legacyStatus);
  if (!db.status.size) console.warn('[catalog] ZERO statuses loaded — CORS allowlist or empty KV');

  onProgress('ranking…');
  const out = [];
  for (const c of byId.values()) {
    const streams = db.streamsByChannel.get(c.id);
    if (!streams) continue;                       // square-one rule: no stream, no card
    c.rank = streams.some(s => GOOD_CDNS.some(g => s.url.includes(g))) ? 0 : 1;
    db.byId.set(c.id, c);
    out.push(c);
  }
  db.channels = out;
  onProgress('');
  return stats();
}
