const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('setShowNavigationWarning')) effect = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const code = ts.transpileModule(`const effect = ${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function warning(measures, valid, loading = false, restoring = false) {
  let visible = false, timer, cleared;
  const window = { setTimeout(callback, delay) { timer = callback; assert.equal(delay, 5000); return 42; }, clearTimeout(id) { cleared = id; } };
  const run = new Function('measures', 'navigation', 'loading', 'restoring', 'setShowNavigationWarning', 'window', `${code}; return effect;`)(measures, { valid }, loading, restoring, value => visible = value, window);
  const cleanup = run();
  return { visible: () => visible, expire: () => timer(), cleanup, cleared: () => cleared };
}
test('no repeat directions, valid routes and unfinished loading do not show warning', () => {
  for (const args of [[[{}, {}], true], [[{}], false], [[{ segno: true, fine: true }], false], [[{ repeatStart: true }], true], [[{ repeatStart: true }], false, true], [[{ jump: 'ds' }], false, false, true]]) {
    const state = warning(...args);
    assert.equal(state.visible(), false);
    assert.equal(state.cleanup, undefined);
  }
});
test('unresolved repeat warning expires after five seconds and cleans up on score change', () => {
  for (const marker of [{ repeatStart: true }, { repeatEnd: true }, { jump: 'ds' }, { volta: [2] }]) {
    const state = warning([marker], false);
    assert.equal(state.visible(), true);
    state.expire();
    assert.equal(state.visible(), false);
    state.cleanup();
    assert.equal(state.cleared(), 42);
  }
});
