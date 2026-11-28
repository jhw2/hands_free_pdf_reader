const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const helpers = {};
new Function('exports', compile(fs.readFileSync('lib/score-loop.ts', 'utf8')))(helpers);
const { resolveMeasureLoop } = helpers;
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['clearMeasureLoop', 'restartMeasureLoop', 'applyMeasureLoop'].includes(node.name.getText(source))) functions[node.name.getText(source)] = node.initializer.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.setInterval' && node.arguments[1]?.getText(source) === '60') functions.poll = node.arguments[0].getText(source);
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'onStateChange') functions.ended = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);

function session({ order = [0,1,2,3,4], bpm = 120, beats = 4, offset = 3, duration = 100 } = {}) {
  let position = 0, state = 1, now = 0, loop = null, fail = false;
  const commands = [], errors = [], times = [], selected = [];
  const player = { getCurrentTime: () => position, getPlayerState: () => state, getDuration: () => duration, getPlaybackRate: () => .7,
    seekTo: target => { if (fail) throw Error('lost connection'); commands.push(['seek',target]); },
    playVideo: () => commands.push('play'), pauseVideo: () => { state = 2; commands.push('pause'); } };
  const env = { resolveMeasureLoop, playbackOrder: order, bpm, beatsPerMeasure: beats, offset, url: 'abcdefghijk', videoId: 'abcdefghijk', getVideoId: value => value,
    playerRef: { current: player }, playerReadyRef: { current: true }, desiredPlayingRef: { current: true }, countdownTimerRef: { current: null }, keyboardSeekRef: { current: null },
    measureLoopRef: { current: null }, repeatAllRef: { current: true }, lastSelectedTargetRef: { current: 0 }, lastProgressRef: { current: { time: 0, changedAt: 0 } },
    lastRecoveryRef: { current: 0 }, pollFailuresRef: { current: 0 }, performance: { now: () => now },
    disposed: false, createdPlayer: player, readPlaybackRates() {}, setRepeatAll() {}, setPlaying() {}, setDuration() {},
    setMeasureLoop: value => { loop = value; }, setError: value => errors.push(value), setTime: value => times.push(value), jumpToMeasure: (...args) => selected.push(args) };
  const code = compile(`let restarting = false; ${Object.entries(functions).map(([name, fn]) => `const ${name} = ${fn};`).join('\n')}`);
  const handlers = new Function(...Object.keys(env), `${code}; return { ${Object.keys(functions).join(',')} };`)(...Object.values(env));
  return { ...handlers, env, commands, errors, times, selected, loop: () => loop, fail: () => { fail = true; },
    tick(time, at = now + 60, nextState = state) { position = time; now = at; state = nextState; handlers.poll(); } };
}

test('measure range includes the entire final measure and uses the repeat-aware timeline', () => {
  const h = session({ order: [0,1,2,0,1,2,3,4] });
  assert.equal(h.applyMeasureLoop(2,4), true);
  assert.deepEqual(h.loop(), { startMeasure: 2, endMeasure: 4, startStep: 1, endStep: 6 });
  assert.equal(h.env.measureLoopRef.current.start, 5);
  assert.equal(h.env.measureLoopRef.current.end, 17);
  assert.deepEqual(h.selected, [[1,1]]);
  assert.equal(h.env.repeatAllRef.current, false);
  h.tick(16.99); assert.deepEqual(h.commands, []);
  h.tick(17); assert.deepEqual(h.commands, [['seek',5],'play']);
  assert.equal(h.times.at(-1), 5);
});
test('single-measure loops use media seconds even at a slow playback rate', () => {
  const h = session({ bpm: 60, beats: 3, offset: 2 });
  h.applyMeasureLoop(3,3);
  assert.equal(h.env.measureLoopRef.current.start, 8);
  assert.equal(h.env.measureLoopRef.current.end, 11);
  h.tick(10.99); assert.deepEqual(h.commands, []);
  h.tick(11); assert.deepEqual(h.commands, [['seek',8],'play']);
});
test('invalid numbers, absent measures, unreachable endings and out-of-video starts are rejected', () => {
  for (const [start,end] of [[0,1],[2,1],[1.5,2],[1,NaN],[1,Infinity],[1,9]]) assert.equal(resolveMeasureLoop([0,1,2],start,end),null);
  assert.equal(resolveMeasureLoop([0,3,1,2],3,4),null);
  const h = session({ duration: 4 });
  assert.equal(h.applyMeasureLoop(2,3),false); assert.equal(h.loop(),null);
  assert.deepEqual(h.selected,[]); assert.equal(h.env.repeatAllRef.current,true);
});
test('pending loop seeks pin the highlight, do not retrigger on stale time, and repeat after confirmation', () => {
  const h = session(); h.applyMeasureLoop(2,3);
  h.tick(9); h.tick(9.1); h.ended({ data: 0 });
  assert.deepEqual(h.commands, [['seek',5],'play']);
  assert.equal(h.times.at(-1),5);
  h.tick(5.04); assert.equal(h.env.keyboardSeekRef.current,null);
  h.tick(9); assert.equal(h.commands.length,4);
});
test('paused playback, count-ins and cleared loops cannot auto-restart', () => {
  const h = session(); h.applyMeasureLoop(2,3);
  h.env.desiredPlayingRef.current = false; h.tick(9,60,2);
  assert.deepEqual(h.commands,[]);
  h.env.desiredPlayingRef.current = true; h.env.countdownTimerRef.current = 42; h.tick(9,120,1);
  assert.deepEqual(h.commands,[]);
  h.env.countdownTimerRef.current = null; h.clearMeasureLoop(); h.tick(9,180,1);
  assert.deepEqual(h.commands,[]); assert.equal(h.loop(),null);
});
test('video ending inside the selected last measure restarts the section rather than the whole song', () => {
  const h = session({ duration: 8.8 }); h.applyMeasureLoop(2,3);
  h.ended({ data: 0 });
  assert.deepEqual(h.commands,[['seek',5],'play']);
  assert.equal(h.env.desiredPlayingRef.current,true);
});
test('failed and timed-out loop seeks stop repetition instead of retrying indefinitely', () => {
  const failed = session(); failed.applyMeasureLoop(2,3); failed.fail(); failed.tick(9);
  assert.equal(failed.env.desiredPlayingRef.current,false); assert.equal(failed.loop(),null);
  assert.equal(failed.errors.length,1); assert.equal(failed.commands.at(-1),'pause');
  const timeout = session(); timeout.applyMeasureLoop(2,3); timeout.tick(9); timeout.tick(9,3200);
  assert.equal(timeout.env.desiredPlayingRef.current,false); assert.equal(timeout.loop(),null);
  assert.equal(timeout.errors.length,1); assert.equal(timeout.commands.filter(c => Array.isArray(c)).length,1);
  const short = session(); short.applyMeasureLoop(2,2); short.tick(7); short.tick(7,2800); short.tick(7,3200);
  assert.equal(short.loop(),null); assert.equal(short.commands.filter(c => Array.isArray(c)).length,1);
});
