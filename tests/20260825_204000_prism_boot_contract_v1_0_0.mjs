import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'assets', 'prism.js'), 'utf8');
const proofName = '20260825_204000_PRISM_WIDGET_DEV_PROOF_v1_0_0.html';
const proof = fs.readFileSync(path.join(root, 'proof', proofName), 'utf8');

const checks = [
  ['stage is validated', source.includes("throw new TypeError('createWindow requires a valid stage element')")],
  ['spawn passes stage as an object property', source.includes('const spawnWindow = stage => createWindow({ stage });')],
  ['window markup includes its loading overlay', source.includes('<div class="pwin-loading">${chipHTML(\'LOADING\')}</div>')],
  ['loading overlay is queried after creation', source.includes("cell.querySelector('.pwin-loading')")],
  ['proof imports the production module contract', proof.includes("import('../assets/prism.js')")],
  ['proof mounts into an isolated target', proof.includes('mod.mountPrism({ target: mount })')],
  ['proof checks the real stage', proof.includes("document.querySelector('.stage-area')")],
  ['proof checks the real player shell', proof.includes("document.querySelector('.pwin video')")],
  ['proof waits for catalog completion', proof.includes('const catalogSettled = await waitFor')],
  ['proof checks rendered category rows', proof.includes("document.querySelectorAll('.guide-row')")],
  ['proof checks horizontal overflow', proof.includes('document.documentElement.scrollWidth <= document.documentElement.clientWidth')],
  ['proof captures runtime errors', proof.includes("addEventListener('error'")],
];

for (const [name, passed] of checks) {
  assert.equal(passed, true, name);
  console.log(`[PASS] ${name}`);
}

console.log(`[PASS] ${checks.length}/${checks.length} PRISM boot-contract checks`);
