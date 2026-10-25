const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['handlePageSwipeStart', 'handlePageSwipeEnd'].includes(node.name.getText(source))) handlers.set(node.name.getText(source), node.initializer.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
class Target {
  constructor(interactive = false) { this.interactive = interactive; }
  closest() { return this.interactive ? this : null; }
}
function viewer({ pages = 5, guideOpen = false } = {}) {
  const captured = new Set(), moved = [];
  const bindings = {
    Element: Target, touchStartRef: { current: null }, pageCountRef: { current: pages },
    practiceRef: { current: { open: guideOpen } }, currentPageRef: { current: 2 },
    TOUCH_SWIPE_MIN_DISTANCE_PX: 50, queuePage: page => moved.push(page), showTemporaryGestureText: () => {},
  };
  function actual(name) {
    assert.ok(handlers.has(name));
    const js = ts.transpileModule(`const run = ${handlers.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    return new Function(...Object.keys(bindings), js + '\nreturn run;')(...Object.values(bindings));
  }
  const currentTarget = {
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id),
  };
  const event = (overrides = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, clientY: 100, target: new Target(), currentTarget, ...overrides });
  return { captured, moved, bindings, start: actual('handlePageSwipeStart'), end: actual('handlePageSwipeEnd'), event };
}

test('the first-screen file label never has its pointer captured', () => {
  for (const pointerType of ['mouse', 'touch']) {
    const h = viewer({ pages: 0 });
    h.start(h.event({ pointerType, target: new Target(true) }));
    assert.equal(h.captured.size, 0);
    assert.equal(h.bindings.touchStartRef.current, null);
  }
});

test('labels, inputs, and nested button content remain clickable with a PDF loaded', () => {
  for (const pointerType of ['mouse', 'touch']) {
    const h = viewer();
    h.start(h.event({ pointerType, target: new Target(true) }));
    h.end(h.event({ pointerType, clientX: 100 }));
    assert.equal(h.captured.size, 0);
    assert.deepEqual(h.moved, []);
  }
});

test('swiping an opened PDF still turns pages on mouse and touch', () => {
  for (const pointerType of ['mouse', 'touch']) {
    const h = viewer();
    h.start(h.event({ pointerType }));
    assert.equal(h.captured.has(1), true);
    h.end(h.event({ pointerType, clientX: 100 }));
    assert.deepEqual(h.moved, [3]);
    assert.equal(h.captured.size, 0);
  }
});

test('a plain click on the PDF does not turn a page', () => {
  const h = viewer();
  h.start(h.event()); h.end(h.event());
  assert.deepEqual(h.moved, []);
});

test('opening the guide prevents the swipe handler from capturing a pointer', () => {
  const h = viewer({ guideOpen: true });
  h.start(h.event());
  assert.equal(h.captured.size, 0);
});
