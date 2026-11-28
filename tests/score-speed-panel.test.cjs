const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const text = fs.readFileSync('app/score-sync/playback-speed.tsx', 'utf8');
const source = ts.createSourceFile('playback-speed.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const translations = {};
new Function('exports', compile(fs.readFileSync('lib/score-i18n.ts', 'utf8')))(translations);
function render({ open = false, rate = .7, minimum = .25, disabled = false } = {}) {
  const exports = {};
  new Function('exports', 'require', compile(text))(exports, name => {
    if (name === 'react') return { useState: () => [open, () => {}], useRef: () => ({ current: null }), useEffect() {} };
    if (name.endsWith('/use-language')) return { useLanguage: () => ({ t: text => translations.scoreEnglish[text] ?? text }) };
    if (name.endsWith('.css')) return { default: {} };
    return require(name);
  });
  return renderToStaticMarkup(React.createElement(exports.default, { rate, minimum, disabled, onOpen() {}, onChange() {} }));
}
test('collapsed control shows only the actual speed and a labelled disclosure button', () => {
  const html = render();
  assert.match(html, /0\.70×/); assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-haspopup="dialog"/); assert.doesNotMatch(html, /role="dialog"/);
});
test('expanded speed panel has a labelled 0.05 slider and natural English controls', () => {
  const html = render({ open: true });
  for (const text of ['role="dialog"', 'type="range"', 'step="0.05"', 'min="0.25"', 'max="1"', 'Decrease speed by 0.05', 'Increase speed by 0.05', 'Close speed settings', 'Normal']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /[가-힣]/);
});
test('unsupported controls are hidden and presets respect the video minimum', () => {
  assert.doesNotMatch(render({ open: true, disabled: true }), /role="dialog"/);
  const html = render({ open: true, minimum: .5, rate: .5 });
  assert.doesNotMatch(html, />0\.25×</);
  assert.match(html, /aria-label="Decrease speed by 0.05" disabled=""/);
  assert.match(render({ open: true, rate: 1 }), /aria-label="Increase speed by 0.05" disabled=""/);
});
test('step buttons use exact 0.05 increments and stop at the limits', () => {
  let step;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'step') step = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const [rate, minimum, direction, expected] of [[.75,.25,-1,.7],[.7,.25,-1,.65],[.65,.25,1,.7],[.25,.25,-1,.25],[1,.25,1,1],[.5,.5,-1,.5]]) {
    let actual;
    const run = new Function('rate', 'minimum', 'onChange', `${compile(`const step = ${step};`)}; return step;`)(rate, minimum, value => actual = value);
    run(direction); assert.equal(actual, expected);
  }
});
