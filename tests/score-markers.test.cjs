const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const sourceText = fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8');
const source = ts.createSourceFile('page.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['detectBeatsPerMeasure', 'readPdfTextItems', 'shouldRetryYoutubeError', 'parseNavigationText', 'applyVoltaPasses', 'sharedBarPositions', 'hasDoubleBarRuns', 'isRepeatDotPair', 'clusterBarColumns', 'hasDenseInk', 'recoverAlignedBars', 'restoreSupportedBars']);
const helpers = source.statements.filter(node => names.has(node.declarationList?.declarations?.[0]?.name?.text));
const snippet = `${helpers.map(node => node.getText(source)).join('\n')}\nmodule.exports = { detectBeatsPerMeasure, readPdfTextItems, shouldRetryYoutubeError, parseNavigationText, applyVoltaPasses, sharedBarPositions, hasDoubleBarRuns, isRepeatDotPair, clusterBarColumns, hasDenseInk, recoverAlignedBars, restoreSupportedBars };`;
const js = ts.transpileModule(snippet, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', js)(loaded, loaded.exports);
const { detectBeatsPerMeasure, readPdfTextItems, shouldRetryYoutubeError, parseNavigationText, applyVoltaPasses, sharedBarPositions, hasDoubleBarRuns, isRepeatDotPair, clusterBarColumns, hasDenseInk, recoverAlignedBars, restoreSupportedBars } = loaded.exports;

test('does not mistake PDF page counters for a time signature', () => {
  assert.equal(detectBeatsPerMeasure('Drowning 1/4 2/4 3/4 4/4'), 4);
  assert.equal(detectBeatsPerMeasure('Meter: 3/4'), 3);
});

test('reads PDF text without requiring Safari stream async iteration', async () => {
  const chunks = [[{ str: 'first' }], [{ str: 'second' }]];
  let released = false;
  const page = { streamTextContent: () => ({ getReader: () => ({
    read: async () => chunks.length ? { done: false, value: { items: chunks.shift() } } : { done: true },
    releaseLock: () => { released = true; },
  }) }) };
  assert.deepEqual(await readPdfTextItems(page), [{ str: 'first' }, { str: 'second' }]);
  assert.equal(released, true);
});

test('retries a transient YouTube 150 once only while idle', () => {
  assert.equal(shouldRetryYoutubeError(150, 0, false), true);
  assert.equal(shouldRetryYoutubeError(150, 1, false), false);
  assert.equal(shouldRetryYoutubeError(150, 0, true), false);
  assert.equal(shouldRetryYoutubeError(101, 0, false), false);
});

test('separates physical strokes before merging nearby barline ink', () => {
  assert.deepEqual(clusterBarColumns([98, 99, 100, 103, 104, 105], 1), [99, 104]);
  assert.deepEqual(clusterBarColumns([99, 104], 5), [104]);
});

test('recognizes a TAB stem continuing beyond the staff', () => {
  assert.equal(hasDenseInk([true, true, true, false]), true);
  assert.equal(hasDenseInk([true, false, true, false]), false);
});

test('restores a rejected barline only when two other systems confirm it', () => {
  assert.deepEqual(recoverAlignedBars([343, 606], [869], [[342, 606, 869], [344, 607, 870]], 3), [343, 606, 869]);
  assert.deepEqual(recoverAlignedBars([343, 606], [869], [[342, 606, 869], [344, 607]], 3), [343, 606]);
});

test('restores only rejected strokes that connect a multi-staff system', () => {
  assert.deepEqual(restoreSupportedBars([426], [664, 700], [664], 3), [426, 664]);
  assert.deepEqual(restoreSupportedBars([426], [664, 700], [], 3), [426]);
});

test('recognizes navigation instructions without treating title text as Fine', () => {
  assert.deepEqual(parseNavigationText('D.S. al Coda'), { jump: 'ds', jumpMode: 'coda' });
  assert.deepEqual(parseNavigationText('D.C. al Fine'), { jump: 'dc', jumpMode: 'fine' });
  assert.deepEqual(parseNavigationText('To Coda'), { toCoda: true });
  assert.equal(parseNavigationText('\uF025').segno, true);
  assert.equal(parseNavigationText('\uF0DE').coda, true);
  assert.equal(parseNavigationText('Fine').fine, true);
  assert.equal(parseNavigationText('(Fine)').fine, undefined);
  assert.equal(parseNavigationText('%').segno, undefined);
});

test('accepts standalone repeat counts but rejects part-only labels', () => {
  assert.equal(parseNavigationText('3x').repeatCount, 3);
  assert.equal(parseNavigationText('x3').repeatCount, 3);
  assert.equal(parseNavigationText('<2x>').repeatCount, 2);
  assert.equal(parseNavigationText('<2x Only>').repeatCount, undefined);
});

test('numbers consecutive volta brackets from their repeat structure', () => {
  const measures = [
    { voltaGroup: 'first' },
    { voltaGroup: 'first', repeatEnd: true },
    { voltaGroup: 'second' },
    {},
  ];
  applyVoltaPasses(measures);
  assert.deepEqual(measures.map(measure => measure.volta), [[1], [1], [2], undefined]);

  const unrelated = [{ voltaGroup: 'decoration' }, {}];
  applyVoltaPasses(unrelated);
  assert.equal(unrelated[0].volta, undefined);
});

test('keeps a barline found by two of three connected staves', () => {
  assert.deepEqual(sharedBarPositions([[100], [101], []], 2), [101]);
  assert.deepEqual(sharedBarPositions([[100], [], []], 2), []);
  assert.deepEqual(sharedBarPositions([[100], []], 2), []);
});

test('requires two bar runs and two unconnected repeat dots', () => {
  assert.equal(hasDoubleBarRuns([10, 11, 15, 16], 10), true);
  assert.equal(hasDoubleBarRuns([10, 11, 12, 13], 10), false);
  assert.equal(isRepeatDotPair([.25, .3], 1, 4), true);
  assert.equal(isRepeatDotPair([.25, .3], 3, 4), false);
});
