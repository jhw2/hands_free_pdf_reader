const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reset, poll, jump, cancel, editUrl, persist;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'storeMetadata') persist = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'disconnectYoutube') reset = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'updateYoutubeUrl') editUrl = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'cancelCountdown') cancel = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'jumpToMeasure') jump = node.initializer.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.setInterval'
    && node.arguments[1]?.getText(source) === '60') poll = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);

test('song saves retain unsaved status across switches and ignore superseded save results', async () => {
  const pending = [], errors = [];
  let unsaved = new Set();
  const env = {
    currentSongRef: { current: { id: 'first', youtubeUrl: 'video-a', bpm: 115 } },
    saveVersionRef: { current: 0 }, pendingSavesRef: { current: new Map() },
    setSongs: () => {}, setSaveError: message => errors.push(message),
    setUnsavedIds: update => { unsaved = update(unsaved); },
    saveSong: song => new Promise((resolve, reject) => pending.push({ song, resolve, reject })),
  };
  const compiled = ts.transpileModule(`const persist = ${persist};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const save = new Function(...Object.keys(env), `${compiled}; return persist;`)(...Object.values(env));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  save({ bpm: 116 }); save({ offset: 2.5 });
  pending[0].reject(Error('old write failed')); await flush();
  assert.deepEqual(errors, []);
  assert.ok(unsaved.has('first'));
  assert.equal(pending[1].song.youtubeUrl, 'video-a');
  pending[1].reject(Error('storage full')); await flush();
  assert.ok(errors.at(-1));
  env.currentSongRef.current = { id: 'second', youtubeUrl: 'video-b', bpm: 92 };
  save({}); pending[2].resolve(); await flush();
  assert.ok(unsaved.has('first'));
  assert.equal(unsaved.has('second'), false);
  env.currentSongRef.current = pending[1].song;
  save({}); pending[3].resolve(); await flush();
  assert.equal(unsaved.size, 0);
  assert.equal(errors.at(-1), '');
});
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
    stopCountIn: () => {}, speakCountIn: () => {}, setExpanded: () => {},
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
  assert.deepEqual(metadata, { youtubeUrl: '', fileName: 'score.pdf', offset: 0 });
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

test('switching songs stops the current session without erasing its saved YouTube link', () => {
  const { disconnect, metadata, env, state } = session();
  disconnect(false);
  assert.equal(metadata.youtubeUrl, 'https://youtu.be/abcdefghijk');
  assert.equal(state.VideoId, null);
  assert.equal(env.countdownTimerRef.current, null);
  assert.equal(env.desiredPlayingRef.current, false);
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

function seeking({ ready = true, url = 'abcdefghijk', advancing = false, unstarted = false } = {}) {
  const harness = session();
  const { env, state } = harness;
  let now = 0, position = 0, playerState = unstarted ? -1 : 2, muted = false, nextTimer = 0;
  const timers = new Map(), audible = [], commands = [];
  const speech = [];
  const player = {
    getCurrentTime: () => position, getDuration: () => 240, getPlayerState: () => playerState,
    mute: () => { muted = true; commands.push('mute'); },
    unMute: () => { muted = false; audible.push(position); },
    loadVideoById: options => { commands.push(['load', options]); unstarted = false; playerState = 1; if (advancing) position = options.startSeconds; },
    seekTo: target => { commands.push(['seek', target]); if (advancing) position = target; },
    playVideo: () => { if (!unstarted) playerState = 1; commands.push('play'); if (!muted) audible.push(position); },
    pauseVideo: () => { playerState = 2; commands.push('pause'); },
  };
  Object.assign(env, {
    speakCountIn: beat => speech.push(beat), stopCountIn: () => speech.push('stop'),
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
  return { ...harness, select, edit, commands, audible, timers, speech, position: value => { position = value; }, playerState: value => { playerState = value; },
    tick: at => {
      if (advancing && playerState === 1) position += (at - now) / 1000;
      now = at;
      for (const fn of [...timers.values()]) fn();
    } };
}

test('count-in speaks one two three four once per second and stops before playback or on cancellation', () => {
  const h = seeking();
  h.select(30);
  for (let at = 50; at <= 5000; at += 50) h.tick(at);
  assert.deepEqual(h.speech.filter(item => typeof item === 'number'), [0, 1, 2, 3]);
  assert.equal(h.speech.at(-1), 'stop');
  h.select(40);
  assert.deepEqual(h.speech.slice(-2), ['stop', 0]);
  h.edit('lmnopqrstuv');
  const count = h.speech.length;
  h.tick(6000);
  assert.equal(h.speech.length, count);
  assert.equal(h.speech.at(-1), 'stop');
});

test('late countdown ticks skip expired spoken numbers instead of queuing a burst', () => {
  const h = seeking();
  h.select(30);
  h.tick(2500);
  h.tick(5000);
  assert.deepEqual(h.speech.filter(item => typeof item === 'number'), [0, 2]);
  assert.equal(h.speech.at(-1), 'stop');
});

function confirmPlayback(h, target, at) {
  h.position(target + .04); h.tick(at + 50);
  h.position(target + .08); h.tick(at + 100);
}

test('forward and backward jumps hold the target even when the next player sample arrives late', () => {
  const h = seeking({ advancing: true });
  h.select(30);
  h.tick(500); // A playing seek would already have passed the 150 ms verification window.
  h.tick(4000);
  confirmPlayback(h, 60, 4000);
  assert.ok(h.audible.length && h.audible.every(time => Math.abs(time - 60) < .15));
  h.audible.length = 0;
  h.select(9);
  h.tick(4500);
  assert.deepEqual(h.audible, []);
  h.tick(8500);
  confirmPlayback(h, 18, 8500);
  assert.ok(h.audible.length && h.audible.every(time => Math.abs(time - 18) < .15));
  assert.equal(h.timers.size, 0);
});

test('selecting a measure loads an unstarted video instead of accepting its optimistic seek timestamp', () => {
  const h = seeking({ unstarted: true, advancing: true });
  h.select(30);
  assert.deepEqual(h.commands, ['mute', ['load', { videoId: 'abcdefghijk', startSeconds: 59.5 }]]);
  assert.deepEqual(h.audible, []);
  h.tick(500);
  h.tick(4000);
  confirmPlayback(h, 60, 4000);
  assert.ok(h.audible.length && h.audible.every(time => Math.abs(time - 60) < .15));
});

test('a measure jump never unmutes an old position when seeking takes longer than four seconds', () => {
  const h = seeking();
  h.select(30);
  h.tick(4000);
  assert.deepEqual(h.audible, [], 'old position zero must remain muted');
  assert.ok(h.timers.size, 'keep verifying the pending seek');
  h.position(59.5);
  h.tick(5000);
  confirmPlayback(h, 60, 5000);
  assert.ok(h.audible.length);
  assert.ok(h.audible.every(time => Math.abs(time - 60) <= .15));
  assert.equal(h.timers.size, 0);
});

test('a ready target waits for the countdown, then plays without starting another asynchronous seek', () => {
  const h = seeking();
  h.select(30);
  h.position(59.5);
  h.tick(500);
  assert.deepEqual(h.audible, []);
  const seeks = h.commands.filter(command => Array.isArray(command)).length;
  h.tick(4000);
  assert.deepEqual(h.audible, [], 'a paused timestamp is not playback confirmation');
  confirmPlayback(h, 60, 4000);
  assert.equal(h.commands.filter(command => Array.isArray(command)).length, seeks);
  assert.ok(h.audible.length && h.audible.every(time => Math.abs(time - 60) < .15));
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
  for (const resuming of [false, true]) {
    const h = seeking();
    h.select(30);
    if (resuming) { h.position(59.5); h.tick(500); h.tick(3500); }
    h.edit('lmnopqrstuv');
    h.position(60.05);
    h.tick(5000);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.audible, []);
    assert.equal(h.env.desiredPlayingRef.current, false);
    assert.equal(h.commands.at(-1), 'pause');
  }
});

test('replaced countdown callbacks cannot seek or play on a later selection or player', () => {
  const h = seeking();
  h.select(30);
  const previous = [...h.timers.values()][0];
  h.select(40);
  const commandCount = h.commands.length;
  previous();
  assert.equal(h.commands.length, commandCount);
  h.position(79.5);
  h.tick(500);
  h.tick(4000);
  confirmPlayback(h, 80, 4000);
  assert.ok(h.audible.length && h.audible.every(time => Math.abs(time - 80) < .15));
  h.select(50);
  h.env.playerRef.current = {};
  const beforeReplacement = h.commands.length;
  h.tick(8000);
  assert.equal(h.commands.length, beforeReplacement);
});


test('a first resume that jumps to the end and then zero stays muted until the selected passage actually plays', () => {
  const h = seeking();
  h.select(30);
  h.position(59.5); h.tick(500); h.tick(4000);
  assert.deepEqual(h.audible, []);
  h.position(240); h.playerState(0); h.tick(4050);
  assert.deepEqual(h.audible, []);
  assert.equal(h.state.Time, 60, 'keep the selected measure while playback is being corrected');
  assert.equal(h.env.desiredPlayingRef.current, false, 'ordinary stall recovery must not compete with the pending jump');
  h.position(0); h.tick(4100);
  assert.deepEqual(h.audible, []);
  const seeks = h.commands.filter(command => Array.isArray(command) && command[0] === 'seek').length;
  h.tick(5050);
  assert.equal(h.commands.filter(command => Array.isArray(command) && command[0] === 'seek').length, seeks + 1);
  assert.deepEqual(h.commands.at(-2), ['seek', 59.5]);
  confirmPlayback(h, 60, 5100);
  assert.ok(h.audible.length && h.audible.every(time => Math.abs(time - 60) < .15));
  assert.equal(h.timers.size, 0);
  assert.equal(h.env.desiredPlayingRef.current, true);
});

test('a frozen optimistic timestamp cannot release audio even if the player reports playing', () => {
  const h = seeking();
  h.select(30);
  h.position(59.5); h.tick(500); h.tick(4000);
  h.tick(4050); h.tick(4100); h.tick(5000);
  assert.deepEqual(h.audible, []);
  assert.ok(h.timers.size);
  h.tick(13000);
  assert.deepEqual(h.audible, []);
  assert.equal(h.timers.size, 0);
  assert.ok(h.state.Error);
});


test('silent lead-in verifies playback before the selected measure instead of consuming its first beat', () => {
  const h = seeking({ advancing: true });
  h.select(30);
  for (let at = 50; at <= 4500; at += 50) h.tick(at);
  assert.ok(h.audible.length && h.audible.every(time => time >= 60 && time < 60.1));
  assert.equal(h.timers.size, 0);
});
