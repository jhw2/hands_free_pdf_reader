const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let attributes;
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'button'
    && node.attributes.properties.some(prop => prop.name?.getText(source) === 'className' && prop.initializer?.expression?.getText(source) === 'styles.grip')) attributes = node.attributes.properties;
  ts.forEachChild(node, visit);
}
visit(source);
function drawer() {
  let expanded = false;
  const env = { dragStartRef: { current: null }, draggedRef: { current: false }, setExpanded: value => { expanded = typeof value === 'function' ? value(expanded) : value; } };
  const handlers = {};
  for (const attribute of attributes) {
    const name = attribute.name?.getText(source);
    if (!name?.startsWith('on')) continue;
    const compiled = ts.transpileModule(`const handler = ${attribute.initializer.expression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    handlers[name] = new Function(...Object.keys(env), `${compiled}; return handler;`)(...Object.values(env));
  }
  return { ...handlers, expanded: () => expanded };
}
const down = (h, y) => h.onPointerDown({ clientY: y, pointerId: 1, currentTarget: { setPointerCapture() {} } });

test('drag opens or closes without a trailing pointer click toggling it again', () => {
  const h = drawer();
  down(h, 100); h.onPointerUp({ clientY: 50 }); h.onClick({ detail: 1 });
  assert.equal(h.expanded(), true);
  down(h, 50); h.onPointerUp({ clientY: 100 }); h.onClick({ detail: 1 });
  assert.equal(h.expanded(), false);
});

test('keyboard activation still works when dragging did not generate a click', () => {
  const h = drawer();
  down(h, 100); h.onPointerUp({ clientY: 50 });
  assert.equal(h.expanded(), true);
  h.onClick({ detail: 0 });
  assert.equal(h.expanded(), false);
  down(h, 100); h.onPointerUp({ clientY: 98 }); h.onClick({ detail: 1 });
  assert.equal(h.expanded(), true);
});
