const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reset;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'disconnectYoutube') reset = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const js = ts.transpileModule(`const reset = ${reset};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

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
