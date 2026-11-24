const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect, updateBpm, needsInput;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('setShowTempoWarning')) effect = node.arguments[0].getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'updateBpm') updateBpm = node.initializer.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'setBpmNeedsInput' && node.arguments[0]?.getText(source).includes('bpmSource')) needsInput = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const tempo = {};
new Function('exports', ts.transpileModule(fs.readFileSync('app/score-sync/tempo.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(tempo);
const requiresInput = new Function('tempo', `return ${needsInput};`);
function warning(bpmNeedsInput, pages = ['score'], loading = false, restoring = false) {
  let visible = false, expire, cleared;
  const run = new Function('bpmNeedsInput', 'pages', 'loading', 'restoring', 'setShowTempoWarning', 'window', `return (${effect})();`);
  const cleanup = run(bpmNeedsInput, pages, loading, restoring, value => visible = value, {
    setTimeout(callback, delay) { assert.equal(delay, 5000); expire = callback; return 42; },
    clearTimeout(id) { cleared = id; },
  });
  return { visible: () => visible, expire, cleanup, cleared: () => cleared };
}
test('only default BPM needs guidance; detected BPM and saved manual values do not', () => {
  for (const [saved, detected, expected] of [
    [undefined, null, true], [undefined, 92, false],
    [{ bpm: 120, bpmSource: 'default' }, null, true],
    [{ bpm: 120, bpmSource: 'default' }, 83, false],
    [{ bpm: 120, bpmSource: 'manual' }, null, false],
    [{ bpm: 92, bpmSource: 'detected' }, null, false],
    [{ bpm: 120 }, null, false],
  ]) assert.equal(requiresInput(tempo.resolveTempo(saved, detected)), expected);
});
test('BPM notice only appears after loading and expires without lingering across songs', () => {
  for (const args of [[false], [true, []], [true, ['score'], true], [true, ['score'], false, true]]) {
    const state = warning(...args);
    assert.equal(state.visible(), false);
    assert.equal(state.expire, undefined);
  }
  const state = warning(true);
  assert.equal(state.visible(), true);
  state.expire(); assert.equal(state.visible(), false);
  state.cleanup(); assert.equal(state.cleared(), 42);
  assert.equal(warning(true, ['another-score']).visible(), true);
});
test('manual BPM input clears guidance and persists a manual value for future loads', () => {
  let needs = true, value, saved;
  const code = ts.transpileModule(`const update = ${updateBpm};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const update = new Function('setBpm', 'setTempoDetected', 'setBpmNeedsInput', 'storeMetadata', `${code}; return update;`)(v => value = v, () => {}, v => needs = v, v => saved = v);
  update(120);
  assert.equal(needs, false);
  assert.equal(value, 120);
  assert.deepEqual(saved, { bpm: 120, bpmSource: 'manual' });
  assert.equal(requiresInput(tempo.resolveTempo(saved, null)), false);
});
