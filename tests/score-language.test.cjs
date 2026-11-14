const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function modules(language = 'en', searchResult) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    let stateIndex = 0;
    const requireModule = name => {
      if (name.endsWith('/use-language')) return { useLanguage: () => ({ language, chooseLanguage() {}, t: (text, values) => load('lib/i18n.ts').translate(language, text, values) }) };
      if (name.endsWith('.css')) return {};
      if (name === 'react' && file.endsWith('/youtube-search.tsx') && searchResult) return {
        ...React, useState: initial => React.useState(stateIndex++ === 0 ? searchResult : initial),
      };
      if (!name.startsWith('.')) return require(name);
      const resolved = path.resolve(path.dirname(file), name);
      return load(['.ts', '.tsx'].map(ext => resolved + ext).find(candidate => fs.existsSync(candidate)) ?? resolved);
    };
    const DOMParser = class { parseFromString(text) { return { documentElement: { textContent: text } }; } };
    new Function('exports', 'require', 'DOMParser', code)(exports, requireModule, DOMParser);
    return exports;
  }
  return load;
}
const load = modules();
const { translate, english } = load('lib/i18n.ts');
const t = (text, values) => translate('en', text, values);

test('the score page renders its intro, controls, and accessibility labels in English', () => {
  const Page = load('app/score-sync/page.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.doesNotMatch(html.replaceAll('한국어', ''), /[가-힣]/);
  assert.match(html, /<h1>[^<]*YouTube<br\/?>(?:[^<]*PDF score)<\/h1>/);
  for (const text of ['Open a PDF score', 'Sync settings', 'Beats per measure', 'My scores']) assert.ok(html.includes(text), text);
  assert.match(html, /aria-label="Choose a PDF score"/);
});

test('search UI is English while user queries, video titles, and channels retain their original text', () => {
  const title = '삭제';
  const query = '내 노래 {page}';
  const Search = modules('en', { query, videos: [{ id: 'abcdefghijk', title, channel: '한국 밴드' }], error: '' })('app/score-sync/youtube-search.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Search, { value: query, disabled: false, isLink: false, onChange() {}, onConnect() {} }));
  assert.match(html, /Search YouTube or paste a link/);
  assert.match(html, /Choose a video/);
  assert.ok(html.includes(`value="${query}"`));
  assert.ok(html.includes(`<strong>${title}</strong>`), 'video title must not be passed through the UI dictionary');
  assert.ok(html.includes('<small>한국 밴드</small>'));
  assert.doesNotMatch(html.replaceAll(title, '').replaceAll(query, '').replaceAll('한국 밴드', ''), /[가-힣]/);
  const filename = '삭제 {page}.pdf';
  assert.ok(t('{name} 삭제', { name: filename }).includes(filename), 'filename and its braces stay untouched during interpolation');
});

test('all repeat and jump controls, symbol names, and route feedback render in English', () => {
  const { markerLabels } = load('app/score-sync/navigation-edits.ts');
  const measures = Array.from({ length: 20 }, (_, index) => ({ id: `m${index}` }));
  const markers = Object.keys(markerLabels).map((kind, index) => ({ measure: index + 1, kind, count: 2, end: index + 1, passes: '1,2', mode: '' }));
  const Editor = load('app/score-sync/navigation-editor.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Editor, {
    measures, saved: { measureIds: measures.map(measure => measure.id), markers }, disabled: false, onSave: async () => true,
  }));
  assert.doesNotMatch(html, /[가-힣]/);
  for (const text of ['Repeats &amp; jumps', 'Alternate endings', 'Total passes', 'After the jump', 'Dal Segno', 'Da Capo', 'Play on passes']) assert.ok(html.includes(text), text);
});

test('repeat validation interpolates translated errors and retains the Korean default', () => {
  const { validateNavigationMarkers } = load('app/score-sync/navigation-edits.ts');
  assert.equal(validateNavigationMarkers([{ measure: 0, kind: 'segno' }], 6, t), 'Enter a measure number between 1 and 6.');
  assert.equal(validateNavigationMarkers([{ measure: 0, kind: 'segno' }], 6), '마디 번호는 1~6 사이로 입력해 주세요.');
  assert.equal(validateNavigationMarkers([{ measure: 3, kind: 'segno' }, { measure: 3, kind: 'segno' }], 6, t), 'There’s a duplicate symbol at measure 3. Remove the duplicate.');
  assert.equal(validateNavigationMarkers([{ measure: 3, kind: 'segno' }], 6, t), null);
});

test('literal translation keys used throughout both pages exist in the shared English dictionary', () => {
  const missing = [];
  for (const file of ['app/page.tsx', 'app/score-sync/page.tsx', 'app/score-sync/youtube-search.tsx', 'app/score-sync/navigation-editor.tsx', 'app/score-sync/navigation-edits.ts']) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const check = node => {
      if (ts.isStringLiteral(node) && !Object.hasOwn(english, node.text)) missing.push(`${file}: ${node.text}`);
      if (ts.isConditionalExpression(node)) { check(node.whenTrue); check(node.whenFalse); }
    };
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0]) check(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});
