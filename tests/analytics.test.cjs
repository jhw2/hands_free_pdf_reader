const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('lib/analytics.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

class Element {
  constructor(attributes = {}, parent = null) { this.attributes = attributes; this.parent = parent; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  matches() { return !!this.disabled; }
  closest(selector) {
    const matches = selector === '[aria-disabled="true"]'
      ? this.attributes['aria-disabled'] === 'true'
      : this.attributes[selector.slice(1, -1)] !== undefined;
    return matches ? this : this.parent?.closest(selector) ?? null;
  }
}
class HTMLInputElement extends Element {}

function analytics(browser) {
  const calls = [];
  const window = browser ?? { gtag: (...args) => calls.push(args) };
  const exports = {};
  new Function('exports', 'window', 'Element', 'HTMLInputElement', js)(exports, window, Element, HTMLInputElement);
  return { ...exports, calls };
}

test('events target the GA4 destination already linked to the supplied Google tag', () => {
  assert.equal(analytics().gaMeasurementId, 'G-GSVS893CJ5');
});

test('only fixed event names and the destination are sent, never DOM content or input values', () => {
  const a = analytics();
  const button = new Element({ 'data-analytics-click': 'score_library_select_click' });
  Object.defineProperties(button, {
    textContent: { get: () => assert.fail('must not read score titles') },
    value: { get: () => assert.fail('must not read user input') },
  });
  a.recordInteraction({ type: 'click', target: new Element({}, button) });
  assert.deepEqual(a.calls, [['event', 'score_library_select_click', { send_to: 'G-GSVS893CJ5' }]]);
  for (const name of ['My private score.pdf', 'https://youtu.be/id', 'invalid_event', `score_${'a'.repeat(40)}`]) a.trackInteraction(name);
  assert.equal(a.calls.length, 1);
});

test('disabled controls, cancelled uploads, and unmarked elements do not count as usage', () => {
  const a = analytics();
  const disabled = new Element({ 'data-analytics-click': 'score_play_click' }); disabled.disabled = true;
  const ariaDisabled = new Element({ 'data-analytics-click': 'score_play_click', 'aria-disabled': 'true' });
  const upload = new HTMLInputElement({ 'data-analytics-change': 'score_pdf_select' }); upload.type = 'file'; upload.files = [];
  for (const target of [disabled, ariaDisabled, new Element(), null]) a.recordInteraction({ type: 'click', target });
  a.recordInteraction({ type: 'change', target: upload });
  a.recordInteraction({ type: 'input', target: new Element({ 'data-analytics-change': 'score_bpm_change' }) });
  assert.deepEqual(a.calls, []);
  upload.files = [{ name: 'private.pdf' }];
  a.recordInteraction({ type: 'change', target: upload });
  a.recordInteraction({ type: 'change', target: new Element({ 'data-analytics-change': 'score_bpm_change' }) });
  assert.deepEqual(a.calls.map(call => call[1]), ['score_pdf_select', 'score_bpm_change']);
});

test('a missing or failing Google tag cannot break a button handler', () => {
  for (const browser of [{}, { gtag: () => { throw Error('blocked'); } }]) {
    assert.doesNotThrow(() => analytics(browser).trackInteraction('score_play_click'));
  }
});

test('analytics attributes contain literal event names, including the conditional play actions', () => {
  const names = new Set();
  const literal = node => {
    if (ts.isStringLiteral(node)) {
      assert.match(node.text, /^(score|reader)_[a-z_]{1,32}$/);
      names.add(node.text); return;
    }
    assert.ok(ts.isConditionalExpression(node), 'do not derive event names from user data');
    literal(node.whenTrue); literal(node.whenFalse);
  };
  for (const file of ['app/page.tsx', 'app/score-sync/page.tsx', 'app/score-sync/navigation-editor.tsx', 'app/score-sync/youtube-search.tsx']) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isJsxAttribute(node) && /^data-analytics-(click|change)$/.test(node.name.getText(source))) {
        literal(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const expected of ['score_play_click', 'score_pause_click', 'score_measure_click', 'score_pdf_select', 'score_bpm_change', 'score_repeat_save_click', 'reader_next_click']) assert.ok(names.has(expected), expected);
});
