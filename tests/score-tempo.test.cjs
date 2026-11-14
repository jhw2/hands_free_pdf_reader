const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync(require.resolve('../app/score-sync/tempo.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(ocr, timers = {}) {
  const exports = {};
  new Function('exports', 'require', 'setTimeout', 'clearTimeout', js)(exports, () => ocr, timers.setTimeout ?? setTimeout, timers.clearTimeout ?? clearTimeout);
  return exports;
}
const { detectTempo, resolveTempo } = load();

test('tempo requires an explicit marking and preserves the initial tempo', () => {
  for (const text of ['♩ = 92', 's =92', 'BPM: 92', '＝ 92']) assert.equal(detectTempo(text), 92);
  for (const text of ['page 92', '13 15 92', '= 9', '= 301', '= 1200']) assert.equal(detectTempo(text), null);
  assert.equal(detectTempo('♩=92 later ♩=120'), 92);
});

test('tempo defaults can be redetected while manual and legacy values are retained', () => {
  assert.deepEqual(resolveTempo(undefined, 92), { bpm: 92, bpmSource: 'detected' });
  assert.deepEqual(resolveTempo(undefined, null), { bpm: 120, bpmSource: 'default' });
  assert.deepEqual(resolveTempo({ bpm: 120, bpmSource: 'default' }, 92), { bpm: 92, bpmSource: 'detected' });
  for (const bpmSource of ['manual', undefined]) {
    assert.deepEqual(resolveTempo({ bpm: 120, bpmSource }, 92), { bpm: 120, bpmSource: 'manual' });
  }
});

function ocrFixture(texts = ['J =92'], verification = 's =92') {
  let terminated = false, calls = 0;
  const worker = {
    setParameters: async () => {}, terminate: async () => { terminated = true; },
    recognize: async (image, options) => {
      calls++;
      if (calls === 2) {
        assert.ok(options.rectangle.left >= 0 && options.rectangle.top >= 0);
        assert.ok(options.rectangle.width <= image.width && options.rectangle.height <= image.height);
        return { data: { text: verification } };
      }
      return { data: { blocks: [{ paragraphs: [{ lines: texts.map(text => ({ text, bbox: { x0: 5, y0: 5, x1: 100, y1: 30 } })) }] }] } };
    },
  };
  const api = { PSM: { SPARSE_TEXT: 11, SINGLE_LINE: 7 }, createWorker: async (lang, mode, options) => {
    assert.equal(lang, 'eng');
    for (const key of ['workerPath', 'corePath', 'langPath']) assert.ok(options[key].startsWith('/ocr'));
    return worker;
  } };
  return { api, terminated: () => terminated, calls: () => calls };
}

test('image tempo checks the marked line twice, rejects ambiguous OCR, and releases the worker', async () => {
  for (const [texts, verification, expected] of [
    [['J =92'], 's =92', 92], [['J =92'], '= 97', null],
    [['Standard tuning', '92'], '', null], [['=92', '=120'], '', null],
  ]) {
    const fixture = ocrFixture(texts, verification);
    assert.equal(await load(fixture.api).detectImageTempo({ width: 110, height: 35 }), expected);
    assert.equal(fixture.terminated(), true);
  }
});

test('OCR failure or a slow worker leaves PDF loading usable', async () => {
  const broken = { createWorker: async () => { throw Error('missing asset'); } };
  assert.equal(await load(broken).detectImageTempo({}), null);
  const fixture = ocrFixture();
  const worker = await fixture.api.createWorker('eng', 1, { workerPath: '/ocr', corePath: '/ocr', langPath: '/ocr' });
  worker.recognize = () => new Promise(() => {});
  const api = { ...fixture.api, createWorker: async () => worker };
  const timers = { setTimeout: callback => setTimeout(callback, 1) };
  assert.equal(await load(api, timers).detectImageTempo({}), null);
  assert.equal(fixture.terminated(), true);
});
