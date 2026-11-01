const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');

const versionFrom = path => fs.readFileSync(path, 'utf8').match(/pdfjsVersion\s*=\s*["']([^"']+)/)?.[1];

test('the public PDF worker matches the installed PDF.js version', () => {
  const publicWorker = require.resolve('../public/pdf.worker.min.mjs');
  const installedWorker = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
  assert.equal(versionFrom(publicWorker), versionFrom(installedWorker));
});
