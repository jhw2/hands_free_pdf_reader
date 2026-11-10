const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

test('the public PDF worker adds compatibility before the installed legacy worker', () => {
  const publicWorker = require.resolve('../public/pdf.worker.min.mjs');
  const installedWorker = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
  const publicContents = fs.readFileSync(publicWorker, 'utf8');
  const installedContents = fs.readFileSync(installedWorker, 'utf8');
  assert.ok(publicContents.endsWith(installedContents));

  const compatibility = publicContents.slice(0, -installedContents.length);
  const context = vm.createContext({});
  vm.runInContext(compatibility, context);
  const copied = vm.runInContext('Array.from(new Uint8Array(Uint8Array.from([1, 2, 3]).buffer.transferToFixedLength(5))).join()', context);
  assert.equal(copied, '1,2,3,0,0');
});

test('PDF readers use the browser-compatible legacy build', () => {
  for (const source of ['../app/page.tsx', '../app/score-sync/page.tsx']) {
    const contents = fs.readFileSync(require.resolve(source), 'utf8');
    assert.match(contents, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  }
});
