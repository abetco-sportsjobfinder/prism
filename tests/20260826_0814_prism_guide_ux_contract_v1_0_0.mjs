/* ============================================================
   PRISM Guide UX contract tests (GUIDE-UX-A1)
   Run: node tests/20260826_0814_prism_guide_ux_contract_v1_0_0.mjs
   Pure-module gates; browser gates live in the proof page.
   ============================================================ */

import assert from 'node:assert/strict';
import {
  filterChannels, sortAZ, groupByCategory, azPage,
  computeCounts, activeFilterLabels, shouldShowEmpty,
  AzPager, scheduleChunk, cancelChunk, normalizeQuery,
  GUIDE_LIMITS,
} from '../assets/prism-guide.js';

const results = [];
function gate(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); }
}

/* ---------- fixture (synthetic — tests only) ---------- */
function makeChannels(n) {
  const countries = ['us', 'uk', 'de', '', 'ca'];
  const cats = [['sports'], ['news'], ['movies', 'series'], [], ['kids'], ['general']];
  const out = [];
  for (let i = 0; i < n; i++) {
    const working = i % 4 !== 0;           // 75% working
    const hasStream = i % 10 !== 0;        // 90% with streams
    out.push({
      id: `ch_${i}`,
      name: `${i % 3 === 0 ? 'CBS' : i % 3 === 1 ? 'NBC' : 'FOX'} Net ${String(i).padStart(6, '0')}`,
      country: countries[i % countries.length],
      categories: cats[i % cats.length],
      hasStream, isWorking: hasStream && working,
    });
  }
  return out;
}
const FIX40K = makeChannels(40000);

/* ---------- G4: filter composition (search+country+working) ---------- */
gate('G4 filterChannels composes search + country + WORKING', () => {
  const ch = [
    { id: '1', name: 'CBS Sports', country: 'us', hasStream: true, isWorking: true },
    { id: '2', name: 'cbs news', country: 'us', hasStream: true, isWorking: false },
    { id: '3', name: 'BBC One', country: 'uk', hasStream: true, isWorking: true },
    { id: '4', name: 'CBS Sport HD', country: 'us', hasStream: true, isWorking: true },
  ];
  const f = { q: '  CBS SPORT ', country: 'us', workingOnly: true };
  const out = filterChannels(ch, f);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(c => c.id), ['1', '4']);
  // case-insensitive + trimmed proven by match on '  CBS SPORT '
});

/* ---------- G10: no mutation of inputs ---------- */
gate('G10 filter/sort/group do not mutate input channels', () => {
  const src = makeChannels(50);
  const snapshot = JSON.stringify(src);
  filterChannels(src, { q: 'net', country: 'us', workingOnly: true });
  sortAZ(src);
  groupByCategory(src);
  azPage(sortAZ(src), 5, 10);
  assert.equal(JSON.stringify(src), snapshot);
});

/* ---------- G5: deterministic CATEGORY ordering ---------- */
gate('G5 category grouping order is deterministic', () => {
  const ch = makeChannels(600);
  const a = groupByCategory(ch).map(g => [g.key, g.count]);
  const b = groupByCategory(ch).map(g => [g.key, g.count]);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
  // priority rows exist when present in data
  const keys = a.map(x => x[0]);
  assert.ok(keys.includes('sports') || keys.includes('general'));
});

/* ---------- G5b: A-Z alphabetical determinism ---------- */
gate('G5b A-Z sort is strictly alphabetical and stable', () => {
  const list = sortAZ(FIX40K.slice(0, 5000));
  for (let i = 1; i < list.length; i++)
    assert.ok(String(list[i - 1].name).localeCompare(String(list[i].name)) <= 0);
  const again = sortAZ(list);
  assert.deepEqual(again.map(c => c.id), list.map(c => c.id));
});

/* ---------- G6: 40k fixture never mounts >250 A-Z rows ---------- */
gate('G6 azPage caps mounted A-Z rows at GUIDE_LIMITS.AZ_LIMIT', () => {
  const sorted = sortAZ(FIX40K);
  const page = azPage(sorted, 0, GUIDE_LIMITS.AZ_LIMIT);
  assert.equal(page.items.length, GUIDE_LIMITS.AZ_LIMIT);
  assert.ok(page.items.length <= 250);
  assert.equal(page.matched, 40000);
  assert.equal(page.rendered, GUIDE_LIMITS.AZ_LIMIT);
  // paging forward never exceeds cap
  const p2 = azPage(sorted, GUIDE_LIMITS.AZ_LIMIT, GUIDE_LIMITS.AZ_LIMIT);
  assert.equal(p2.items.length, GUIDE_LIMITS.AZ_LIMIT);
});

/* ---------- G7: stale incremental work invalidated ---------- */
gate('G7 chunk scheduling invalidates stale work via epoch', () => {
  let stored = null, cleared = 0;
  const timers = {
    setTimeout: fn => { stored = fn; return 42; },
    clearTimeout: id => { if (id === 42) cleared++; },
  };
  const st = { epoch: 0, runEpoch: 0, timer: null };
  scheduleChunk(timers, st, 10, () => { throw new Error('stale chunk ran'); });
  cancelChunk(timers, st);
  assert.equal(stored === null || cleared >= 1, true);
  assert.equal(st.timer, null);
  // running the captured callback after cancel must still be guarded:
  let ran = false;
  const st2 = { epoch: 1, runEpoch: 1, timer: null };
  scheduleChunk(timers, st2, 0, () => { ran = true; });
  st2.epoch++;                       // invalidate before flush
  stored && stored();                // fire stale callback if captured
  assert.equal(ran, false);
});

/* ---------- G8: matched vs rendered separation ---------- */
gate('G8 counts separate matched from rendered', () => {
  const c = computeCounts(40715, 250);
  assert.equal(c.matched, 40715);
  assert.equal(c.rendered, 250);
  assert.notEqual(c.matched, c.rendered);
});

/* ---------- G9: empty state + labels + reset semantics ---------- */
gate('G9 empty detection, active-filter labels, reset filters', () => {
  assert.equal(shouldShowEmpty(0), true);
  assert.equal(shouldShowEmpty(12), false);
  const labels = activeFilterLabels({ q: ' hbo ', country: 'us', workingOnly: true });
  assert.deepEqual(labels, ['search “hbo”', 'country US', 'WORKING only']);
  assert.deepEqual(normalizeQuery('  HBO '), 'hbo');
  // reset semantics = default filter object matches everything
  const all = makeChannels(30);
  const reset = filterChannels(all, { q: '', country: 'all', workingOnly: false });
  assert.equal(reset.length, all.length);
});

/* ---------- extra: pager exhaustion edge ---------- */
gate('pager handles empty and exhausted lists', () => {
  const p0 = new AzPager([], {});
  const page0 = p0.next();
  assert.equal(page0.items.length, 0);
  assert.equal(p0.exhausted, true);
  const one = new AzPager(FIX40K.slice(0, 3), {});
  one.next();
  assert.equal(one.exhausted, true);          // 3 items fit in one 250 page
  const big = new AzPager(FIX40K.slice(0, 300), {});
  big.next();
  assert.equal(big.exhausted, false);         // 300 > 250 → more pages remain
});

/* ---------- report ---------- */
let fail = 0;
for (const [status, name] of results) {
  console.log(`[${status}] ${name}`);
  if (status === 'FAIL') fail++;
}
console.log(`${fail === 0 ? results.length : results.length - fail}/${results.length} guide-ux contract checks`);
process.exit(fail ? 1 : 0);
