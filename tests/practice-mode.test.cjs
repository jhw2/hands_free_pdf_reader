const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['handleGesture', 'queuePage', 'updateDetectionFeedback'].includes(node.name.getText(source))) {
    expressions.set(node.name.getText(source), node.initializer.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
function actualFunction(name, bindings) {
  assert.ok(expressions.has(name));
  const compiled = ts.transpileModule(`const run = ${expressions.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}\nreturn run;`)(...Object.values(bindings));
}
function practice({ active = true, pages = 10, page = 2, target = 'left' } = {}) {
  const practiceRef = { current: { active, result: 'listening', phase: 'idle', target } };
  const moved = [];
  const results = [];
  const lastSwitchTimeRef = { current: 9999 };
  const gesture = actualFunction('handleGesture', {
    practiceRef, setPracticeResult: result => results.push(result),
    performance: { now: () => 10000 }, lastSwitchTimeRef, PAGE_TURN_COOLDOWN_MS: 1200,
    pageCountRef: { current: pages }, currentPageRef: { current: page },
    queuePage: value => moved.push(value), showTemporaryGestureText: () => {}, updateGestureText: () => {},
  });
  return { practiceRef, moved, results, gesture, lastSwitchTimeRef };
}

test('practice succeeds without a PDF and bypasses navigation cooldown', () => {
  const p = practice({ pages: 0, page: 1 });
  assert.equal(p.gesture('left'), true);
  assert.equal(p.practiceRef.current.result, 'success');
  assert.deepEqual(p.results, ['success']);
  assert.deepEqual(p.moved, []);
  assert.equal(p.lastSwitchTimeRef.current, 9999);
});

test('a long opening reports the wrong gesture without moving a loaded PDF', () => {
  const p = practice();
  p.gesture('right');
  assert.equal(p.practiceRef.current.result, 'held');
  assert.deepEqual(p.moved, []);
});

test('practice result stays visible until retry, even after another gesture', () => {
  const p = practice();
  p.gesture('left');
  p.gesture('right');
  assert.deepEqual(p.results, ['success']);
  assert.deepEqual(p.moved, []);
});

test('normal page navigation still works outside practice', () => {
  const p = practice({ active: false });
  p.lastSwitchTimeRef.current = 0;
  p.gesture('left');
  assert.deepEqual(p.moved, [1]);
  assert.deepEqual(p.results, []);
});

test('all queued navigation is blocked while practicing', () => {
  const queuePage = actualFunction('queuePage', { practiceRef: { current: { active: true } } });
  // No PDF bindings are supplied: the guard must return before touching them.
  assert.equal(queuePage(3), undefined);
});

test('missing the second opening gives retry guidance instead of success', () => {
  const p = practice();
  p.practiceRef.current.phase = 'first-closed';
  const feedback = actualFunction('updateDetectionFeedback', {
    practiceRef: p.practiceRef, setPracticeResult: result => p.results.push(result),
    setPracticePhase: () => {}, setIsGestureActive: () => {}, setDetectionStatus: () => {}, setMouthProgress: () => {},
  });
  feedback({ phase: 'idle', stableFrames: 0, startedAt: null, closedAt: null });
  assert.equal(p.practiceRef.current.result, 'missed');
  assert.deepEqual(p.results, ['missed']);
  assert.deepEqual(p.moved, []);
});


test('next-page practice recognizes a hold without navigating', () => {
  const p = practice({ target: 'right' });
  p.gesture('right');
  assert.deepEqual(p.results, ['success']);
  assert.deepEqual(p.moved, []);
});

test('next-page practice identifies a double opening as the other gesture', () => {
  const p = practice({ target: 'right' });
  p.gesture('left');
  assert.deepEqual(p.results, ['previous']);
  assert.deepEqual(p.moved, []);
});

test('closing early during next-page practice lets the user retry', () => {
  const p = practice({ target: 'right' });
  p.practiceRef.current.phase = 'first-closed';
  const feedback = actualFunction('updateDetectionFeedback', {
    practiceRef: p.practiceRef, setPracticeResult: result => p.results.push(result),
    setPracticePhase: () => {}, setIsGestureActive: () => {}, setDetectionStatus: () => {}, setMouthProgress: () => {},
  });
  feedback({ phase: 'idle', stableFrames: 0, startedAt: null, closedAt: null });
  assert.equal(p.practiceRef.current.result, 'listening');
  assert.deepEqual(p.results, []);
});
