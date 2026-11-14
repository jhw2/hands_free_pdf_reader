const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', code)(exports);
  return exports;
}
const { getNavigationMarkers, buildNavigationMeasures, validateNavigationMarkers, navigationEditsMatch } = load('app/score-sync/navigation-edits.ts');
const { compilePlaybackOrder } = load('app/score-sync/navigation.ts');
const ticket = Array.from({ length: 106 }, (_, i) => ({ id: `m${i}`, page: Math.floor(i / 38) + 1 }));
Object.assign(ticket[9], { segno: true }); Object.assign(ticket[24], { fine: true });
Object.assign(ticket[42], { repeatStart: true }); Object.assign(ticket[77], { repeatEnd: true });
for (let i = 58; i <= 77; i++) ticket[i].volta = [1];
ticket[78].volta = [2]; Object.assign(ticket[105], { jump: 'ds', jumpMode: 'fine' });

test('recognized repeats, long endings and D.S. round-trip without changing playback', () => {
  const markers = getNavigationMarkers(ticket);
  assert.equal(markers.length, 7);
  assert.deepEqual(markers.find(m => m.kind === 'volta'), { measure: 59, kind: 'volta', end: 78, passes: '1' });
  assert.equal(validateNavigationMarkers(markers, 106), null);
  const reconstructed = buildNavigationMeasures(ticket, markers);
  assert.deepEqual(compilePlaybackOrder(reconstructed), compilePlaybackOrder(ticket));
  assert.equal(compilePlaybackOrder(reconstructed).order.length, 138);
  assert.equal(reconstructed[42].id, ticket[42].id);
  assert.equal(ticket[77].repeatEnd, true, 'keeps detected data for reset');
});
test('adding, relocating and removing symbols updates the actual playback path', () => {
  const score = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` }));
  const markers = [{ measure: 2, kind: 'segno' }, { measure: 3, kind: 'fine' }, { measure: 6, kind: 'ds', mode: 'fine' }];
  assert.deepEqual(compilePlaybackOrder(buildNavigationMeasures(score, markers)).order, [0, 1, 2, 3, 4, 5, 1, 2]);
  markers[0].measure = 3;
  assert.deepEqual(compilePlaybackOrder(buildNavigationMeasures(score, markers)).order, [0, 1, 2, 3, 4, 5, 2]);
  const cleared = buildNavigationMeasures(ticket, []);
  assert.deepEqual(compilePlaybackOrder(cleared).order, Array.from({ length: 106 }, (_, i) => i));
  const repeat = [{ measure: 2, kind: 'repeatStart' }, { measure: 4, kind: 'repeatEnd', count: 3 }];
  assert.deepEqual(compilePlaybackOrder(buildNavigationMeasures(score, repeat)).order, [0, 1, 2, 3, 1, 2, 3, 1, 2, 3, 4, 5]);
});
test('validation rejects invalid positions, repeat counts and overlapping endings', () => {
  for (const markers of [null, [null], [{ measure: 0, kind: 'segno' }], [{ measure: 7, kind: 'segno' }], [{ measure: 1.5, kind: 'segno' }],
    [{ measure: 2, kind: 'unknown' }], [{ measure: 2, kind: 'repeatEnd', count: 1 }], [{ measure: 2, kind: 'repeatEnd', count: Infinity }],
    [{ measure: 2, kind: 'volta', end: 1, passes: '1' }], [{ measure: 2, kind: 'volta', end: 3, passes: '0,1' }],
    [{ measure: 2, kind: 'volta', end: 3, passes: '1,x' }], [{ measure: 2, kind: 'ds' }, { measure: 2, kind: 'dc' }],
    [{ measure: 2, kind: 'volta', end: 4, passes: '1' }, { measure: 4, kind: 'volta', end: 5, passes: '2' }]]) {
    assert.ok(validateNavigationMarkers(markers, 6), JSON.stringify(markers));
  }
  assert.equal(validateNavigationMarkers([{ measure: 2, kind: 'volta', end: 3, passes: '1, 2' }], 6), null);
  assert.equal(compilePlaybackOrder(buildNavigationMeasures(ticket, [{ measure: 106, kind: 'ds' }])).valid, false);
});
test('saved overrides apply only to the same detected measures', () => {
  const edits = { measureIds: ticket.map(m => m.id), markers: [] };
  assert.equal(navigationEditsMatch(edits, ticket), true);
  assert.equal(navigationEditsMatch(edits, ticket.slice(1)), false);
  assert.equal(navigationEditsMatch(edits, [{ id: 'changed' }, ...ticket.slice(1)]), false);
});
