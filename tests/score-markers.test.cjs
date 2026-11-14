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

test('decodes Maestro segno without turning ordinary percentages into jumps', () => {
  for (const font of ['Maestro', 'LILDNN+Maestro']) assert.equal(parseNavigationText('%', font).segno, true);
  for (const font of ['', 'TimesNewRoman', 'ABCDEF+Arial', 'MaestroText']) assert.equal(parseNavigationText('%', font).segno, undefined);
  assert.equal(parseNavigationText('50%', 'Maestro').segno, undefined);
});

test('guitar technique labels containing D C do not create da capo jumps', () => {
  for (const text of ['C&D C', 'U&D C', 'C&D C U&D C', 'QC C&D C', 'U&D C C', 'Practice D.C. slowly']) {
    assert.equal(parseNavigationText(text).jump, undefined, text);
  }
  for (const text of ['D.C.', 'D C', 'Da Capo', '(D.C. al Fine)', '다 카포 알 피네']) {
    assert.equal(parseNavigationText(text).jump, 'dc', text);
  }
  for (const text of ['D.S.', 'D S', 'Dal Segno', '(D.S. al Coda)', '달 세뇨 알 코다']) {
    assert.equal(parseNavigationText(text).jump, 'ds', text);
  }
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

test('continues an open first ending across systems and pages to the next ending', () => {
  const measures = Array.from({ length: 99 }, () => ({}));
  measures[17].repeatStart = true;
  Object.assign(measures[24], { voltaGroup: '3-0-3', voltaOpen: true });
  measures[40].repeatEnd = true;
  Object.assign(measures[41], { voltaGroup: '4-1-4', voltaOpen: true });
  applyVoltaPasses(measures);
  assert.ok(measures.slice(24, 41).every(measure => measure.volta?.[0] === 1));
  assert.deepEqual(measures[41].volta, [2]);
  assert.ok([...measures.slice(0, 24), ...measures.slice(42)].every(measure => !measure.volta));
});

test('does not extend a closed or unpaired bracket, or cross another repeat start', () => {
  for (const condition of ['closed', 'no repeat end', 'another repeat']) {
    const measures = [
      { voltaGroup: 'first', voltaOpen: condition !== 'closed' },
      condition === 'another repeat' ? { repeatStart: true } : {},
      condition === 'no repeat end' ? {} : { repeatEnd: true },
      { voltaGroup: 'next', voltaOpen: true },
    ];
    applyVoltaPasses(measures);
    assert.ok(measures.every(measure => !measure.volta), condition);
  }
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
