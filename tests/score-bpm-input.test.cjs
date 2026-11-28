const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let update, props;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'updateBpm') update = node.initializer.getText(source);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'input'
    && node.attributes.properties.some(p => p.name?.getText(source) === 'data-analytics-change' && p.initializer?.text === 'score_bpm_change')) props = node.attributes.properties;
  ts.forEachChild(node, visit);
}
visit(source);
const handler = name => props.find(p => p.name?.getText(source) === name).initializer.expression.getText(source);
const code = ts.transpileModule(`const updateBpm = ${update}; const change = ${handler('onChange')}; const blur = ${handler('onBlur')}; const key = ${handler('onKeyDown')}; const displayed = () => ${handler('value')};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function input(initial = 120) {
  const saved = [], cleared = [];
  const env = { bpm: initial, bpmInput: null };
  Object.assign(env, { setBpm: value => env.bpm = value, setBpmInput: value => env.bpmInput = value,
    setTempoDetected: value => cleared.push(value), setBpmNeedsInput: value => cleared.push(value), storeMetadata: value => saved.push(value) });
  const bind = () => new Function(...Object.keys(env), `${code}; return { change, blur, key, displayed };`)(...Object.values(env));
  return { saved, cleared, env, displayed: () => bind().displayed(),
    type(value) { bind().change({ target: { value } }); },
    blur() { bind().blur({ currentTarget: { value: String(env.bpmInput ?? env.bpm) } }); },
    enter() { let prevented = false; bind().key({ key: 'Enter', preventDefault: () => prevented = true, currentTarget: { blur: () => this.blur() } }); assert.ok(prevented); },
  };
}
test('clearing and typing 138 keeps every draft digit and saves only the completed value', () => {
  const h = input();
  for (const value of ['', '1', '13', '138']) {
    h.type(value);
    assert.equal(h.displayed(), value);
    assert.equal(h.env.bpm, 120);
    assert.deepEqual(h.saved, []);
  }
  h.blur();
  assert.equal(h.displayed(), 138);
  assert.deepEqual(h.saved, [{ bpm: 138, bpmSource: 'manual' }]);
});
test('an oversized draft can be corrected before Enter commits it', () => {
  const h = input();
  for (const value of ['399', '', '1', '13', '138']) { h.type(value); assert.equal(h.displayed(), value); }
  h.enter();
  assert.equal(h.displayed(), 138);
  assert.equal(h.saved.length, 1);
});
test('empty, out-of-range and non-finite completed input restores the last valid BPM without saving', () => {
  for (const value of ['', ' ', '1', '29', '301', '399', 'Infinity', 'NaN']) {
    const h = input(138); h.type(value); h.blur();
    assert.equal(h.displayed(), 138);
    assert.deepEqual(h.saved, []);
    assert.deepEqual(h.cleared, [], 'invalid input must not dismiss the missing-BPM guidance');
  }
});
test('valid boundary values and decimal BPMs are accepted on completion', () => {
  for (const value of ['30', '300', '138.5']) {
    const h = input(); h.type(value); h.enter();
    assert.equal(h.displayed(), Number(value));
    assert.equal(h.saved[0].bpm, Number(value));
  }
});
