const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const text = fs.readFileSync('app/score-sync/measure-loop.tsx','utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const translations = {};
new Function('exports', compile(fs.readFileSync('lib/score-i18n.ts','utf8')))(translations);
function component({ open = false, start = '2', end = '4', disabled = false, loop = null, apply = () => true } = {}) {
  const exports = {}, errors = [];
  let index = 0;
  new Function('exports','require',compile(text))(exports, name => {
    if (name === 'react') return { useState: () => [[open,start,end,''][index++], value => errors.push(value)], useRef: () => ({ current: null }), useEffect() {} };
    if (name.endsWith('/use-language')) return { useLanguage: () => ({ t: (text, values = {}) => (translations.scoreEnglish[text] ?? text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`) }) };
    if (name.endsWith('.css')) return { default: {} };
    return require(name);
  });
  return { tree: exports.default({ count: 12, current: 2, loop, disabled, onOpen() {}, onApply: apply, onClear() {} }), errors };
}
test('loop popup is closed by default and active range remains visible on its trigger', () => {
  const html = renderToStaticMarkup(component().tree);
  assert.match(html, /A–B/); assert.match(html, /aria-haspopup="dialog"/); assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /role="dialog"/);
  const active = renderToStaticMarkup(component({ loop: { startMeasure: 2, endMeasure: 4 } }).tree);
  assert.match(active, /aria-pressed="true"/); assert.match(active, /Loop measures 2–4/);
});
test('popup labels inputs, uses free numeric drafts and has natural English controls', () => {
  const html = renderToStaticMarkup(component({ open: true, loop: { startMeasure: 2, endMeasure: 4 } }).tree);
  for (const expected of ['role="dialog"','Start measure','End measure','Start loop','Turn loop off','Close loop settings','min="1"','max="12"']) assert.ok(html.includes(expected),expected);
  assert.doesNotMatch(html, /[가-힣]/);
  assert.doesNotMatch(renderToStaticMarkup(component({ open: true, disabled: true }).tree), /role="dialog"/);
});
test('submitting validates drafts without clamping typing and only closes on successful application', () => {
  for (const [start,end] of [['','3'],['0','3'],['4','2'],['1.5','3'],['1','13']]) {
    let calls = 0;
    const h = component({ open: true, start, end, apply: () => { calls++; return true; } });
    h.tree.props.children[1].props.onSubmit({ preventDefault() {} });
    assert.equal(calls,0); assert.match(h.errors[0], /Enter measures/);
  }
  const calls = [], good = component({ open: true, start: '3', end: '3', apply: (...range) => { calls.push(range); return true; } });
  good.tree.props.children[1].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls,[[3,3]]); assert.deepEqual(good.errors,[false]);
  const failed = component({ open: true, apply: () => false });
  failed.tree.props.children[1].props.onSubmit({ preventDefault() {} });
  assert.match(failed.errors[0], /can’t be played/);
});
