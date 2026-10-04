const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

// Exercise the actual camera callback with deterministic landmark ratios and time.
const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let smoothing;
const constants = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'getSmoothedMouthRatio') smoothing = node.initializer.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'faceMesh.onResults') callback = node.arguments[0].getText(source);
  if (ts.isVariableStatement(node) && node.parent === source && node.getText(source).startsWith('const MOUTH_')) constants.push(node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'camera callback exists');
const compiled = ts.transpileModule(`${constants.join('\n')}\nconst onResults = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
assert.ok(smoothing, 'actual smoothing function exists');
const compiledSmoothing = ts.transpileModule(`${constants.join('\n')}\nconst smooth = ${smoothing};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const smoothRatio = new Function(`${compiledSmoothing}\nreturn smooth;`)();
function detector({ useSmoothing = false } = {}) {
  let now = 0;
  const moves = [];
  const state = { current: { phase: 'idle', startedAt: null, closedAt: null, stableFrames: 0 } };
  const smoothed = { current: null };
  const mouthHoldDurationRef = { current: 500 };
  const onResults = new Function('mouthStateRef', 'mouthHoldDurationRef', 'smoothedMouthRef', 'performance', 'handleGesture', 'updateGestureText', 'computeMouthOpenRatio', 'getSmoothedMouthRatio', 'cancelled', 'updateDetectionFeedback', `${compiled}\nreturn onResults;`)(state, mouthHoldDurationRef, smoothed, { now: () => now }, direction => moves.push(direction), () => {}, ratio => ratio, useSmoothing ? smoothRatio : (_ref, ratio) => ratio, false, () => {});
  return {
    moves, state, mouthHoldDurationRef,
    sample(time, ratio) { now = time; onResults({ multiFaceLandmarks: ratio === null ? [] : [ratio] }); },
  };
}

test('holding open for 0.5 seconds advances once until mouth closes', () => {
  const d = detector();
  for (const time of [0, 50, 250, 500]) d.sample(time, 0.5);
  assert.deepEqual(d.moves, []);
  d.sample(550, 0.5);
  d.sample(1000, 0.5);
  assert.deepEqual(d.moves, ['right']);
  d.sample(1100, 0.1);
  assert.equal(d.state.current.phase, 'idle');
});

test('two short openings go back once without advancing', () => {
  const d = detector();
  d.sample(0, 0.5); d.sample(50, 0.5); d.sample(200, 0.1);
  d.sample(350, 0.5); d.sample(400, 0.5); d.sample(1000, 0.5);
  assert.deepEqual(d.moves, ['left']);
});

test('a late second opening starts a new gesture instead of going back', () => {
  const d = detector();
  d.sample(0, 0.5); d.sample(50, 0.5); d.sample(200, 0.1);
  d.sample(1150, 0.5); d.sample(1200, 0.5);
  assert.deepEqual(d.moves, []);
  d.sample(1700, 0.5);
  assert.deepEqual(d.moves, ['right']);
});

test('a very brief opening does not arm a previous-page gesture', () => {
  const d = detector();
  d.sample(0, 0.5); d.sample(50, 0.5); d.sample(75, 0.1);
  d.sample(200, 0.5); d.sample(250, 0.5);
  assert.deepEqual(d.moves, []);
  assert.equal(d.state.current.phase, 'open');
});

test('losing the face clears an unfinished gesture', () => {
  const d = detector();
  d.sample(0, 0.5); d.sample(50, 0.5); d.sample(200, null);
  d.sample(1000, 0.5); d.sample(1050, 0.5);
  assert.deepEqual(d.moves, []);
});


test('a single closed frame between openings goes back with actual smoothing', () => {
  const d = detector({ useSmoothing: true });
  d.sample(0, 0.6); d.sample(50, 0.6); d.sample(150, 0.6);
  d.sample(200, 0.1);
  assert.equal(d.state.current.phase, 'first-closed');
  d.sample(250, 0.6); d.sample(300, 0.6);
  d.sample(600, 0.6); d.sample(900, 0.6);
  assert.deepEqual(d.moves, ['left']);
});

test('a second opening within 0.6 seconds still goes back', () => {
  const d = detector({ useSmoothing: true });
  d.sample(0, 0.6); d.sample(50, 0.6); d.sample(200, 0.1);
  d.sample(650, 0.6); d.sample(700, 0.6); d.sample(1250, 0.6);
  assert.deepEqual(d.moves, ['left']);
});

test('small fluctuations during a hold do not count as closing', () => {
  const d = detector({ useSmoothing: true });
  d.sample(0, 0.6); d.sample(50, 0.6); d.sample(200, 0.25);
  d.sample(350, 0.6); d.sample(550, 0.6); d.sample(900, 0.6);
  assert.deepEqual(d.moves, ['right']);
});


test('rapid double opening with a first hold under 120ms goes back', () => {
  const d = detector({ useSmoothing: true });
  d.sample(0, 0.6); d.sample(30, 0.6); d.sample(90, 0.1);
  d.sample(120, 0.45); d.sample(150, 0.1);
  assert.deepEqual(d.moves, ['left']);
  assert.equal(d.state.current.phase, 'idle');
});

test('two single-frame openings at low camera frame rates go back', () => {
  const d = detector({ useSmoothing: true });
  d.sample(0, 0.1); d.sample(100, 0.45); d.sample(160, 0.1);
  d.sample(220, 0.45); d.sample(280, 0.1);
  assert.deepEqual(d.moves, ['left']);
});

test('a fleeting single-frame spike does not arm the previous gesture', () => {
  const d = detector({ useSmoothing: true });
  d.sample(0, 0.1); d.sample(100, 0.45); d.sample(120, 0.1);
  d.sample(180, 0.45); d.sample(200, 0.1);
  assert.deepEqual(d.moves, []);
});


test('the configured hold duration controls when the next page advances', () => {
  const d = detector();
  d.mouthHoldDurationRef.current = 300;
  d.sample(0, 0.5); d.sample(50, 0.5); d.sample(349, 0.5);
  assert.deepEqual(d.moves, []);
  d.sample(350, 0.5);
  assert.deepEqual(d.moves, ['right']);
});


test('two quick openings go back without requiring a long first opening', () => {
  const d = detector();
  d.sample(0, 0.5); d.sample(30, 0.5); d.sample(100, 0.1);
  d.sample(130, 0.5); d.sample(160, 0.5);
  assert.deepEqual(d.moves, ['left']);
});
