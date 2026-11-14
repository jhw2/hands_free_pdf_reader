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
    assert.match(contents, /cMapUrl: "\/cmaps\/", cMapPacked: true/);
  }
});

test('PDF CMaps and browser OCR assets are supplied by the build', () => {
  const assets = {
    'cmaps/Adobe-Korea1-UCS2.bcmap': 'pdfjs-dist/cmaps/Adobe-Korea1-UCS2.bcmap',
    'ocr/worker.min.js': 'tesseract.js/dist/worker.min.js',
    'ocr/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  };
  for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
    for (const suffix of ['wasm', 'wasm.js']) assets[`ocr/tesseract-core-${variant}.${suffix}`] = `tesseract.js-core/tesseract-core-${variant}.${suffix}`;
  }
  for (const [asset, installed] of Object.entries(assets)) {
    assert.ok(fs.readFileSync(require.resolve(`../public/${asset}`)).equals(fs.readFileSync(require.resolve(installed))), asset);
  }
});
