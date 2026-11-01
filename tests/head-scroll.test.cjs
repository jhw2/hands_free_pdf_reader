const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
const constants = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText(source);
    if (['computeHeadPitchRatio', 'resetHeadScroll', 'updateHeadScroll'].includes(name)) functions.set(name, node.initializer.getText(source));
    if (name.startsWith('HEAD_')) constants.set(name, node.initializer.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);

function landmarks(pitchRatio) {
  const points = Array.from({ length: 153 }, () => ({ x: 0, y: 0 }));
  points[10] = { x: 0, y: 0 };
  points[152] = { x: 0, y: 1 };
  points[1] = { x: 0, y: pitchRatio };
  return points;
}

function detector(zoom = 1.5, scrollable = true) {
  const viewer = { scrollTop: 0, scrollLeft: 0, scrollHeight: scrollable ? 1000 : 500, clientHeight: 500 };
  const activeStates = [];
  const env = {
    pdfZoomRef: { current: zoom }, practiceRef: { current: { open: false } }, pdfViewerRef: { current: viewer },
    headNeutralRef: { current: null }, headTiltStartedAtRef: { current: null }, headScrollLastFrameRef: { current: null }, headScrollDirectionRef: { current: null },
    setHeadScrollDirection: value => activeStates.push(value),
  };
  for (const [name, value] of constants) env[name] = Function(`return (${value})`)();
  for (const name of ['computeHeadPitchRatio', 'resetHeadScroll', 'updateHeadScroll']) {
    const js = ts.transpileModule(`const run = ${functions.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    env[name] = new Function(...Object.keys(env), `${js}\nreturn run;`)(...Object.values(env));
  }
  return { env, viewer, activeStates, sample: (time, pitch) => env.updateHeadScroll(landmarks(pitch), time) };
}

test('head movement does nothing at the default PDF size', () => {
  const d = detector(1, false);
  d.sample(0, 0.5);
  d.sample(500, 0.6);
  assert.equal(d.viewer.scrollTop, 0);
});

test('a width-fit landscape score scrolls by head movement at 100%', () => {
  const d = detector(1, true);
  d.sample(0, 0.5);
  d.sample(100, 0.55);
  d.sample(400, 0.55);
  assert.ok(d.viewer.scrollTop > 0);
});

test('holding the head down scrolls only after the hold threshold', () => {
  const d = detector();
  d.sample(0, 0.5);
  d.sample(100, 0.55);
  d.sample(300, 0.55);
  assert.equal(d.viewer.scrollTop, 0);
  d.sample(360, 0.55);
  assert.ok(d.viewer.scrollTop > 0);
  assert.deepEqual(d.activeStates, ['down']);
});

test('returning to neutral stops head scrolling', () => {
  const d = detector();
  d.sample(0, 0.5);
  d.sample(100, 0.55);
  d.sample(400, 0.55);
  const scrolled = d.viewer.scrollTop;
  d.sample(450, 0.5);
  d.sample(600, 0.5);
  assert.equal(d.viewer.scrollTop, scrolled);
  assert.deepEqual(d.activeStates, ['down', null]);
});

test('holding the head up scrolls upward after the hold threshold', () => {
  const d = detector();
  d.viewer.scrollTop = 200;
  d.sample(0, 0.5);
  d.sample(100, 0.45);
  d.sample(400, 0.45);
  assert.ok(d.viewer.scrollTop < 200);
  assert.deepEqual(d.activeStates, ['up']);
});
