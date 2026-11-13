const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reset, poll, jump, cancel, editUrl;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'disconnectYoutube') reset = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'updateYoutubeUrl') editUrl = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'cancelCountdown') cancel = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'jumpToMeasure') jump = node.initializer.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.setInterval'
    && node.arguments[1]?.getText(source) === '60') poll = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const js = ts.transpileModule(`const reset = ${reset};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function bindCancel(env) {
  const js = ts.transpileModule(`const cancel = ${cancel};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(env), `${js}\nreturn cancel;`)(...Object.values(env));
}

function session(storageFails = false) {
  const state = {};
  const cleared = [];
  const metadata = { youtubeUrl: 'https://youtu.be/abcdefghijk', fileName: 'score.pdf' };
  const env = {
    countdownTimerRef: { current: 42 }, desiredPlayingRef: { current: true }, playerReadyRef: { current: true },
    lastSelectedTargetRef: { current: 90 }, youtubeRetryRef: { current: 1 },
    window: { clearInterval: id => cleared.push(id) },
    storeMetadata: changes => { if (storageFails) throw Error('storage unavailable'); Object.assign(metadata, changes); },
  };
  for (const name of ['Url', 'VideoId', 'PlayerReady', 'Playing', 'Countdown', 'CountdownMeasure', 'Time', 'Offset', 'Duration', 'Error']) {
    env[`set${name}`] = value => { state[name] = value; };
  }
  env.cancelCountdown = bindCancel(env);
  const disconnect = new Function(...Object.keys(env), `${js}\nreturn reset;`)(...Object.values(env));
  return { disconnect, state, env, cleared, metadata };
}

test('disconnecting cancels a pending measure jump and removes the saved video', () => {
  const { disconnect, state, env, cleared, metadata } = session();
  disconnect();
  assert.deepEqual(cleared, [42]);
  assert.equal(env.countdownTimerRef.current, null);
  assert.equal(env.desiredPlayingRef.current, false);
  assert.equal(env.playerReadyRef.current, false);
  assert.equal(state.VideoId, null);
  assert.equal(state.PlayerReady, false);
  assert.equal(state.Countdown, null);
  assert.equal(state.Time, 0);
  assert.equal(state.Offset, 0);
  assert.deepEqual(metadata, { youtubeUrl: '', fileName: 'score.pdf' });
  disconnect();
  assert.deepEqual(cleared, [42]);
});

test('storage failure still disconnects playback and reports that the old link could not be cleared', () => {
  const { disconnect, state, env } = session(true);
  assert.doesNotThrow(disconnect);
  assert.equal(state.Url, '');
  assert.equal(state.VideoId, null);
  assert.equal(env.desiredPlayingRef.current, false);
  assert.equal(env.countdownTimerRef.current, null);
  assert.match(state.Error, /저장 공간/);
});

test('delayed YouTube seek samples cannot replace the selected measure during its countdown', () => {
  let displayedTime = 90;
  let youtubeTime = 0;
  const env = {
    playerRef: { current: { getCurrentTime: () => youtubeTime, getDuration: () => 240, getPlayerState: () => 2 } },
    playerReadyRef: { current: true }, countdownTimerRef: { current: 42 }, desiredPlayingRef: { current: false },
    lastProgressRef: { current: { time: 0, changedAt: 0 } }, pollFailuresRef: { current: 0 },
    setTime: value => { displayedTime = value; }, setPlaying: () => {}, setDuration: () => {},
    setError: message => assert.fail(message), performance: { now: () => 1000 },
  };
  const compiled = ts.transpileModule(`const poll = ${poll};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const tick = new Function(...Object.keys(env), `${compiled}\nreturn poll;`)(...Object.values(env));
  tick();
  assert.equal(displayedTime, 90, 'the old zero timestamp must not scroll back to the first measure');
  displayedTime = 120; // The user selects a different measure while the earlier seek is still completing.
  youtubeTime = 90;
  tick();
  assert.equal(displayedTime, 120);
  env.countdownTimerRef.current = null;
  youtubeTime = 121;
  tick();
  assert.equal(displayedTime, 121, 'normal playback tracking resumes after the countdown');
});

function seeking({ ready = true, url = 'abcdefghijk' } = {}) {
  const harness = session();
  const { env, state } = harness;
  let now = 0, position = 0, playerState = 2, muted = false, nextTimer = 0;
  const timers = new Map(), audible = [], commands = [];
  const player = {
    getCurrentTime: () => position, getDuration: () => 240, getPlayerState: () => playerState,
    mute: () => { muted = true; commands.push('mute'); },
    unMute: () => { muted = false; audible.push(position); },
    seekTo: target => commands.push(['seek', target]),
    playVideo: () => { playerState = 1; commands.push('play'); if (!muted) audible.push(position); },
    pauseVideo: () => { playerState = 2; commands.push('pause'); },
  };
  Object.assign(env, {
    playerRef: { current: player }, playerReadyRef: { current: ready }, countdownTimerRef: { current: null },
    videoId: 'abcdefghijk', url, getVideoId: value => value,
    bpm: 120, beatsPerMeasure: 4, time: 0, offset: 0, playbackOrder: Array.from({ length: 150 }, (_, i) => i),
    lastProgressRef: { current: { time: 0, changedAt: 0 } }, performance: { now: () => now },
    window: { setInterval: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: id => timers.delete(id), setTimeout: () => {} },
  });
  env.cancelCountdown = bindCancel(env);
  const compiled = ts.transpileModule(`const jump = ${jump};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const select = new Function(...Object.keys(env), `${compiled}\nreturn jump;`)(...Object.values(env));
  const editJs = ts.transpileModule(`const edit = ${editUrl};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const edit = new Function(...Object.keys(env), `${editJs}\nreturn edit;`)(...Object.values(env));
  return { ...harness, select, edit, commands, audible, timers, position: value => { position = value; },
    tick: at => { now = at; for (const fn of [...timers.values()]) fn(); } };
}

test('a measure jump never unmutes an old position when seeking takes longer than four seconds', () => {
  const h = seeking();
  h.select(30);
  h.tick(4000);
  assert.deepEqual(h.audible, [], 'old position zero must remain muted');
  assert.ok(h.timers.size, 'keep verifying the pending seek');
  h.position(60);
  h.tick(5000);
  assert.ok(h.audible.length);
  assert.ok(h.audible.every(time => Math.abs(time - 60) <= .15));
  assert.equal(h.timers.size, 0);
});

test('a ready target waits for the countdown, then plays without starting another asynchronous seek', () => {
  const h = seeking();
  h.select(30);
  h.position(60);
  h.tick(500);
  assert.deepEqual(h.audible, []);
  const seeks = h.commands.filter(command => Array.isArray(command)).length;
  h.tick(4000);
  assert.equal(h.commands.filter(command => Array.isArray(command)).length, seeks);
  assert.ok(h.audible.every(time => time === 60));
});

test('unready players and unconnected edited links cannot play the previous video', () => {
  for (const options of [{ ready: false }, { url: 'lmnopqrstuv' }]) {
    const h = seeking(options);
    h.select(30);
    assert.deepEqual(h.commands, []);
    assert.equal(h.timers.size, 0);
    assert.ok(h.state.Error);
  }
});

test('failed seeks stop with an error instead of playing from zero forever', () => {
  const h = seeking();
  h.select(30);
  h.tick(13000);
  assert.deepEqual(h.audible, []);
  assert.equal(h.timers.size, 0);
  assert.equal(h.env.desiredPlayingRef.current, false);
  assert.ok(h.state.Error);
});

test('a measure beyond the video duration is rejected before playback', () => {
  const h = seeking();
  h.select(125);
  assert.deepEqual(h.commands, []);
  assert.ok(h.state.Error);
});

test('editing the video link cancels a pending jump before the old video can unmute', () => {
  const h = seeking();
  h.select(30);
  h.edit('lmnopqrstuv');
  h.position(60);
  h.tick(5000);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.audible, []);
  assert.equal(h.env.desiredPlayingRef.current, false);
  assert.equal(h.commands.at(-1), 'pause');
});

test('replaced countdown callbacks cannot seek or play on a later selection or player', () => {
  const h = seeking();
  h.select(30);
  const previous = [...h.timers.values()][0];
  h.select(40);
  const commandCount = h.commands.length;
  previous();
  assert.equal(h.commands.length, commandCount);
  h.position(80);
  h.tick(4000);
  assert.ok(h.audible.length && h.audible.every(time => time === 80));
  h.select(50);
  h.env.playerRef.current = {};
  const beforeReplacement = h.commands.length;
  h.tick(8000);
  assert.equal(h.commands.length, beforeReplacement);
});
