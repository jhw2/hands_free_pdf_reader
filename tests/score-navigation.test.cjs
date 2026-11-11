const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../app/score-sync/navigation.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', 'require', js)(loaded, loaded.exports, require);
const { compilePlaybackOrder } = loaded.exports;

const order = measures => compilePlaybackOrder(measures).order;

test('plays an unmarked score linearly', () => {
  assert.deepEqual(order([{}, {}, {}]), [0, 1, 2]);
});

test('plays an ordinary repeat twice by default', () => {
  assert.deepEqual(order([
    { repeatStart: true }, {}, { repeatEnd: true }, {},
  ]), [0, 1, 2, 0, 1, 2, 3]);
});

test('treats a written x3 as three total plays', () => {
  assert.deepEqual(order([
    { repeatStart: true }, { repeatEnd: 3 },
  ]), [0, 1, 0, 1, 0, 1]);
});

test('selects first and second endings by repeat pass', () => {
  const result = compilePlaybackOrder([
    { repeatStart: true },
    { volta: [1], repeatEnd: true },
    { voltaPasses: [2] },
    {},
  ]);
  assert.deepEqual(result.order, [0, 1, 0, 2, 3]);
  assert.equal(result.valid, true);
});

test('skips the long first ending after the second verse in Shaking Time', () => {
  const measures = Array.from({ length: 99 }, () => ({}));
  measures[17].repeatStart = true;
  for (let i = 24; i <= 40; i++) measures[i].volta = [1];
  measures[40].repeatEnd = true;
  measures[41].volta = [2];
  const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i - 1);
  const result = compilePlaybackOrder(measures);
  assert.equal(result.valid, true);
  assert.deepEqual(result.order, [...range(1, 41), ...range(18, 24), ...range(42, 99)]);
});

test('selects first, second, and third endings by repeat pass', () => {
  const result = compilePlaybackOrder([
    { repeatStart: true },
    { volta: [1], repeatEnd: true },
    { volta: [2], repeatEnd: true },
    { volta: [3] },
    {},
  ]);
  assert.deepEqual(result.order, [0, 1, 0, 2, 0, 3, 4]);
  assert.equal(result.valid, true);
});

test('replays a completed inner repeat on each outer repeat pass', () => {
  assert.deepEqual(order([
    { repeatStart: true },
    {},
    { repeatStart: true },
    {},
    { repeatEnd: true },
    { repeatEnd: true },
    {},
  ]), [0, 1, 2, 3, 4, 2, 3, 4, 5, 0, 1, 2, 3, 4, 2, 3, 4, 5, 6]);
});

test('D.C. al Fine ignores Fine until the return traversal', () => {
  assert.deepEqual(order([
    {}, { fine: true }, {}, { jump: 'dc', jumpMode: 'fine' }, {},
  ]), [0, 1, 2, 3, 0, 1]);
});

test('D.S. al Coda returns to Segno and takes To Coda once', () => {
  assert.deepEqual(order([
    {}, { segno: true }, {}, { toCoda: true }, {},
    { jump: 'ds', jumpMode: 'coda' }, {}, { coda: true }, {},
  ]), [0, 1, 2, 3, 4, 5, 1, 2, 3, 7, 8]);
});

test('D.S. al Coda selects the Segno belonging to its To Coda route', () => {
  assert.deepEqual(order([
    {}, { segno: true }, {}, { toCoda: true }, {},
    { segno: true }, {}, { jump: 'ds', jumpMode: 'coda' },
    { coda: true }, {},
  ]), [0, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 8, 9]);
});

test('a long jump does not reactivate a completed repeat', () => {
  assert.deepEqual(order([
    { repeatStart: true }, { repeatEnd: true }, { jump: 'dc' }, {},
  ]), [0, 1, 0, 1, 2, 0, 1, 2, 3]);
});

test('malformed navigation is bounded instead of hanging', () => {
  const result = compilePlaybackOrder([{ repeatEnd: Number.MAX_SAFE_INTEGER }]);
  assert.deepEqual(result.order, [0, 0]);
  assert.equal(result.valid, false);
  assert.match(result.warnings.join(' '), /invalid repeat count/i);
});

test('falls back safely when a volta is detected without its repeat barline', () => {
  const result = compilePlaybackOrder([{}, { volta: [2] }, {}]);
  assert.equal(result.valid, false);
  assert.match(result.warnings.join(' '), /volta.*repeat end/i);
});
