const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
test('start time accepts decimal seconds, defaults cleared input to zero and rejects invalid values', () => {
  let handler;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'input') {
      const props = node.attributes.properties;
      if (props.some(p => p.name?.getText(source) === 'value' && p.initializer?.expression?.getText(source) === 'offset')) {
        assert.ok(props.some(p => p.name?.getText(source) === 'type' && p.initializer.text === 'number'));
        handler = props.find(p => p.name?.getText(source) === 'onChange').initializer.expression.getText(source);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let offset = 0, saved;
  const code = ts.transpileModule(`const handler = ${handler}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const change = new Function('setOffset', 'storeMetadata', `${code}; return handler;`)(v => offset = v, v => saved = v.offset);
  for (const [input, expected] of [['12.5',12.5], ['0',0], ['24',24], ['',0], ['-1',0], ['Infinity',0], ['oops',0]]) {
    change({target: {value: input}});
    assert.equal(offset, expected);
    assert.equal(saved, expected);
  }
});
