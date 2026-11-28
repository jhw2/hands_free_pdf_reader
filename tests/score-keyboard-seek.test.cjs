const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let keyboard, poll, cancel, playbackStep, toggle;
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(source);
    if (name === 'seekWithKeyboard') keyboard = node.initializer.getText(source);
    if (name === 'togglePlayback') toggle = node.initializer.getText(source);
    if (name === 'cancelCountdown') cancel = node.initializer.getText(source);
    if (name === 'playbackStep') playbackStep = node.initializer.arguments[0].getText(source);
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.setInterval' && node.arguments[1]?.getText(source) === '60') poll = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
class HTMLElement { constructor(blocked = false, editable = false, control = null) { this.blocked = blocked; this.isContentEditable = editable; this.control = control; } closest(selector) { return selector.startsWith("button") ? this.control : this.blocked; } }
function session({ position = 20, duration = 100, playing = true, ready = true, counting = false, url = 'abcdefghijk', fail = false } = {}) {
  let now = 0, state = playing ? 1 : 2;
  const commands = [], errors = [], displayed = [], cleared = [];
  const player = { getCurrentTime: () => position, getDuration: () => duration, getPlayerState: () => state, getPlaybackRate: () => .7,
    seekTo: (target, ahead) => { if (fail) throw Error('player lost'); commands.push(['seek', target, ahead]); },
    playVideo: () => { state = 1; commands.push('play'); }, pauseVideo: () => { state = 2; commands.push('pause'); }, unMute: () => commands.push('unmute') };
  const env = { HTMLElement, videoId: 'abcdefghijk', url, getVideoId: value => value, playerRef: { current: player }, playerReadyRef: { current: ready },
    measureLoopRef: { current: null }, clearMeasureLoop() { env.measureLoopRef.current = null; }, restartMeasureLoop: () => false, keyboardSeekRef: { current: null }, countdownTimerRef: { current: counting ? 42 : null }, lastSelectedTargetRef: { current: counting ? 60 : 0 },
    desiredPlayingRef: { current: playing && !counting }, lastProgressRef: { current: { time: position, changedAt: 0 } }, lastRecoveryRef: { current: 0 }, pollFailuresRef: { current: 0 },
    performance: { now: () => now }, stopCountIn: () => commands.push('stop-count'), window: { clearInterval: id => cleared.push(id) },
    setExpanded() {}, setCountdown() {}, setCountdownMeasure() {}, setPlaying() {}, setDuration() {}, setTime: value => displayed.push(value), setError: value => { if (value) errors.push(value); } };
  const code = compile(`const cancelCountdown = ${cancel}; const togglePlayback = ${toggle}; const keyboard = ${keyboard}; const poll = ${poll};`);
  const handlers = new Function(...Object.keys(env), `${code}; return { keyboard, poll, cancelCountdown };`)(...Object.values(env));
  return { env, commands, displayed, errors, cleared, cancel: handlers.cancelCountdown,
    key(key, extra = {}) { let prevented = false; handlers.keyboard({ key, target: new HTMLElement(), preventDefault: () => prevented = true, ...extra }); return prevented; },
    sample(time, at, nextState = state) { position = time; now = at; state = nextState; handlers.poll(); } };
}
test('arrow keys seek ten media seconds, preserve playback and accumulate rapid presses', () => {
  const h = session();
  assert.equal(h.key('ArrowRight'), true); h.key('ArrowRight'); h.key('ArrowLeft');
  assert.deepEqual(h.commands.filter(c => Array.isArray(c)), [['seek',30,true],['seek',40,true],['seek',30,true]]);
  assert.deepEqual(h.displayed, [30,40,30]);
  assert.equal(h.env.desiredPlayingRef.current, true);
  assert.equal(h.commands.filter(c => c === 'play').length, 3);
});
test('paused playback stays paused and seeking is bounded by the start and end', () => {
  const h = session({ position: 5, playing: false });
  h.key('ArrowLeft'); assert.equal(h.displayed.at(-1), 0);
  assert.ok(h.commands.includes('pause')); assert.ok(!h.commands.includes('play'));
  const end = session({ position: 96 }); end.key('ArrowRight');
  assert.equal(end.displayed.at(-1), 100);
  assert.equal(end.env.keyboardSeekRef.current.atEnd, true);
  assert.equal(end.env.lastSelectedTargetRef.current, 0, 'Play after reaching the end should restart at zero');
});
test('keyboard seek replaces a countdown using its selected time and clears queued speech', () => {
  const h = session({ counting: true, position: 0 }); h.key('ArrowLeft');
  assert.deepEqual(h.cleared, [42]); assert.ok(h.commands.includes('stop-count'));
  assert.equal(h.displayed.at(-1), 50);
  assert.ok(h.commands.includes('unmute')); assert.ok(h.commands.includes('play'));
  assert.equal(h.env.countdownTimerRef.current, null);
});
test('inputs, contenteditable, speed dialogs, composition and modified keys are left alone', () => {
  for (const extra of [{ target: new HTMLElement(true) }, { target: new HTMLElement(false,true) }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    const h = session(); assert.equal(h.key('ArrowRight',extra),false); assert.deepEqual(h.commands,[]);
  }
  const h = session(); assert.equal(h.key('ArrowUp'),false); assert.deepEqual(h.commands,[]);
  for (const options of [{ ready:false }, { url:'changed-link' }]) {
    const h = session(options); assert.equal(h.key('ArrowRight'),false); assert.deepEqual(h.commands,[]);
  }
});
test('stale player samples cannot pull the score back after a keyboard seek', () => {
  const h = session(); h.key('ArrowRight');
  h.sample(20,60); assert.equal(h.displayed.at(-1),30); assert.ok(h.env.keyboardSeekRef.current);
  h.sample(30.05,120); assert.equal(h.displayed.at(-1),30.05); assert.equal(h.env.keyboardSeekRef.current,null);
  h.sample(30.1,180); assert.equal(h.displayed.at(-1),30.1);
});
test('highlight follows the repeat-aware score timeline and offset after seeking', () => {
  const h = session({ position: 4 }); h.key('ArrowRight');
  const playbackOrder = [0,1,2,3,1,2,3,4,5];
  const compute = new Function('time','offset','bpm','beatsPerMeasure','playbackOrder', `return (${playbackStep})();`);
  const step = compute(h.displayed.at(-1), 2, 120, 4, playbackOrder);
  assert.equal(step,6); assert.equal(playbackOrder[step],3);
});
test('failed seeks report errors and session cancellation releases pinned timestamps', () => {
  const failed = session({ fail:true }); failed.key('ArrowRight');
  assert.equal(failed.errors.length,1); assert.equal(failed.env.keyboardSeekRef.current,null);
  assert.equal(failed.env.desiredPlayingRef.current,false);
  const timeout = session(); timeout.key('ArrowRight'); timeout.sample(20,3100,2);
  assert.equal(timeout.errors.length,1); assert.equal(timeout.env.keyboardSeekRef.current,null);
  const switched = session(); switched.key('ArrowRight'); switched.cancel();
  assert.equal(switched.env.keyboardSeekRef.current,null);
});

test('Space toggles play and pause immediately and prevents page scrolling', () => {
  const h = session({ playing:false });
  assert.equal(h.key(' '),true); assert.equal(h.env.desiredPlayingRef.current,true);
  assert.equal(h.commands.at(-1),'play');
  assert.equal(h.key(' '),true); assert.equal(h.env.desiredPlayingRef.current,false);
  assert.equal(h.commands.at(-1),'pause');
});
test('holding Space only toggles once while repeat events still prevent scrolling', () => {
  const h = session({ playing:false }); h.key(' ');
  const count = h.commands.length;
  assert.equal(h.key(' ',{repeat:true}),true);
  assert.equal(h.commands.length,count);
});
test('Space cancels a pending count-in instead of starting it again', () => {
  const h = session({ counting:true }); h.key(' ');
  assert.deepEqual(h.cleared,[42]); assert.ok(h.commands.includes('stop-count'));
  assert.equal(h.commands.at(-1),'pause'); assert.equal(h.env.desiredPlayingRef.current,false);
});
test('Space keeps text editing and native control actions, but pauses a focused score measure', () => {
  for (const extra of [{ target:new HTMLElement(true) },{ target:new HTMLElement(false,true) },{ target:new HTMLElement(false,false,{matches:()=>false}) },{ isComposing:true },{ ctrlKey:true }]) {
    const h=session(); assert.equal(h.key(' ',extra),false); assert.deepEqual(h.commands,[]);
  }
  const h=session();
  assert.equal(h.key(' ',{target:new HTMLElement(false,false,{matches:()=>true})}),true);
  assert.equal(h.commands.at(-1),'pause'); assert.ok(!h.commands.some(c=>Array.isArray(c)));
});


test('keyboard seeking inside a loop keeps it, while leaving its range releases it', () => {
  const h = session({ position: 20 });
  h.env.measureLoopRef.current = { start: 10, end: 40 };
  h.key('ArrowRight'); assert.ok(h.env.measureLoopRef.current);
  h.key('ArrowRight'); assert.equal(h.env.measureLoopRef.current,null);
});
