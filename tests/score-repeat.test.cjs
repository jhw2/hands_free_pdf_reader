const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, toggle;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'onStateChange') callback = node.initializer.getText(source);
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'button') {
    const props = node.attributes.properties;
    if (props.some(p => p.name?.getText(source) === 'data-analytics-click' && p.initializer?.text === 'score_repeat_toggle_click')) {
      toggle = props.find(p => p.name?.getText(source) === 'onClick').initializer.expression.getText(source);
      assert.ok(props.some(p => p.name?.getText(source) === 'aria-pressed' && p.initializer.expression.getText(source) === 'repeatAll'));
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
function session({ repeat = true, desired = true, countdown = null, ready = true, disposed = false, fails = false } = {}) {
  const commands = [], times = [], errors = [];
  const env = {
    disposed, clearMeasureLoop() {}, restartMeasureLoop: () => false, keyboardSeekRef: { current: null }, repeatAllRef: { current: repeat }, desiredPlayingRef: { current: desired }, countdownTimerRef: { current: countdown }, playerReadyRef: { current: ready },
    lastSelectedTargetRef: { current: 80 }, lastProgressRef: { current: { time: 180, changedAt: 0 } },
    performance: { now: () => 2000 }, readPlaybackRates() {}, setPlaying() {}, setRepeatAll() {}, setTime: time => times.push(time), setError: message => errors.push(message),
    createdPlayer: { seekTo: (time, ahead) => { if (fails) throw Error('disconnected'); commands.push(['seek', time, ahead]); }, playVideo: () => commands.push('play') },
  };
  const code = ts.transpileModule(`let restarting = false; const change = ${callback}; const toggle = ${toggle};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const handlers = new Function(...Object.keys(env), `${code}; return { change, toggle };`)(...Object.values(env));
  return { ...handlers, env, commands, times, errors };
}
test('repeat restarts the whole video from zero on each natural end, without a count-in', () => {
  const h = session();
  h.change({ data: 0 });
  assert.deepEqual(h.commands, [['seek', 0, true], 'play']);
  assert.deepEqual(h.times, [0]);
  assert.equal(h.env.lastSelectedTargetRef.current, 0);
  assert.equal(h.env.desiredPlayingRef.current, true);
  h.change({ data: 0 });
  assert.equal(h.commands.length, 2, 'duplicate end event must not trigger another seek');
  h.change({ data: 1 }); h.change({ data: 0 });
  assert.equal(h.commands.length, 4, 'repeat continues on the next completed play');
});
test('off, pause, pending measure seeks, unready and disposed players cannot restart', () => {
  for (const options of [{ repeat: false }, { desired: false }, { countdown: 42 }, { ready: false }, { disposed: true }]) {
    const h = session(options); h.change({ data: 0 });
    assert.deepEqual(h.commands, []);
  }
  const h = session();
  for (const data of [-1, 1, 2, 3, 5]) h.change({ data });
  assert.deepEqual(h.commands, []);
});
test('toggling repeat takes effect immediately in the existing player callback', () => {
  const h = session({ repeat: false });
  h.toggle(); h.change({ data: 0 });
  assert.equal(h.commands.length, 2);
  h.change({ data: 1 }); h.toggle(); h.change({ data: 0 });
  assert.equal(h.commands.length, 2);
  assert.equal(h.env.desiredPlayingRef.current, false);
});
test('restart failures stop automatic playback and report the existing connection error', () => {
  const h = session({ fails: true });
  assert.doesNotThrow(() => h.change({ data: 0 }));
  assert.equal(h.env.desiredPlayingRef.current, false);
  assert.equal(h.errors.length, 1);
});

test('stale ended events during keyboard seeks cannot loop, but intentionally seeking to the end can', () => {
  const h = session();
  h.env.keyboardSeekRef.current = { target: 50, at: 0, atEnd: false };
  h.change({ data: 0 });
  assert.deepEqual(h.commands, []);
  assert.equal(h.env.desiredPlayingRef.current, true);
  h.env.keyboardSeekRef.current = { target: 180, at: 0, atEnd: true };
  h.change({ data: 0 });
  assert.deepEqual(h.commands, [['seek', 0, true], 'play']);
  assert.equal(h.env.keyboardSeekRef.current, null);
});
