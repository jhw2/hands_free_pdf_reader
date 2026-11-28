const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['readPlaybackRates', 'changePlaybackRate'].includes(node.name.getText(source))) functions[node.name.getText(source)] = node.initializer.getText(source);
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'onPlaybackRateChange') functions.changed = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
function session({ disposed = false, ready = true, countdown = null, fails = false, rates = Array.from({ length: 16 }, (_, index) => (20 - index) / 20) } = {}) {
  const requested = [], errors = [], displayed = [], available = [];
  const player = { getPlaybackRate: () => 1, getAvailablePlaybackRates: () => rates, setPlaybackRate: rate => { if (fails) throw Error('player missing'); requested.push(rate); } };
  const env = { disposed, playerReadyRef: { current: ready }, playerRef: { current: player }, countdownTimerRef: { current: countdown }, minimumPlaybackRate: Math.max(.25, Math.min(1, ...rates.filter(rate => Number.isFinite(rate) && rate > 0 && rate <= 1))),
    setMinimumPlaybackRate: value => available.push(value), setPlaybackRate: value => displayed.push(value), setError: value => errors.push(value) };
  const code = ts.transpileModule(Object.entries(functions).map(([name, fn]) => `const ${name} = ${fn};`).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const handlers = new Function(...Object.keys(env), `${code}; return { readPlaybackRates, changePlaybackRate, changed };`)(...Object.values(env));
  return { ...handlers, player, requested, errors, displayed, available };
}
test('speed input uses the video minimum and ignores invalid preset values', () => {
  const h = session({ rates: [2, 1, .25, .5, .75, 1.25, 1.5, 1.75, 2, NaN, 0, -1, Infinity] });
  h.readPlaybackRates(h.player);
  assert.deepEqual(h.available, [.25]);
  assert.deepEqual(h.displayed, [1]);
  const normal = session({ rates: [] }); normal.readPlaybackRates(normal.player);
  assert.deepEqual(normal.available, [1]);
});
test('selecting a speed uses YouTube without claiming the change until its confirmation', () => {
  const h = session(); h.changePlaybackRate(.5);
  assert.deepEqual(h.requested, [.5]); assert.deepEqual(h.displayed, []);
  h.changed({ data: .5 }); assert.deepEqual(h.displayed, [.5]);
  h.changed({ data: 1.5 }); assert.deepEqual(h.displayed, [.5, 1.5]);
});
test('unavailable speeds, pending jumps and disconnected players cannot change speed', () => {
  for (const options of [{ ready: false }, { countdown: 42 }]) {
    const h = session(options); h.changePlaybackRate(.5); assert.deepEqual(h.requested, []);
  }
  const h = session(); for (const rate of [0, NaN, Infinity, .2, 1.5, 2, 3]) h.changePlaybackRate(rate);
  assert.deepEqual(h.requested, []);
  const old = session({ disposed: true }); old.changed({ data: 2 }); assert.deepEqual(old.displayed, []);
  for (const data of [NaN, Infinity, 0, -1]) h.changed({ data }); assert.deepEqual(h.displayed, []);
});
test('speed failures report an error and preserve the displayed speed', () => {
  const h = session({ fails: true });
  assert.doesNotThrow(() => h.changePlaybackRate(.5));
  assert.equal(h.errors.length, 1); assert.deepEqual(h.displayed, []);
});

test('an external YouTube speed remains accurately displayed even when outside the practice-speed options', () => {
  const h = session({ rates: [.25, .5, .75, 1, 1.5, 2] });
  h.player.getPlaybackRate = () => 1.5;
  h.readPlaybackRates(h.player);
  assert.deepEqual(h.available, [.25]);
  assert.deepEqual(h.displayed, [1.5]);
});

test('does not offer speeds below the current video minimum', () => {
  const h = session({ rates: [.5, .55, .6, .65, .7, .75, .8, .85, .9, .95, 1, 2] });
  h.readPlaybackRates(h.player);
  assert.deepEqual(h.available, [.5]);
});

test('0.70 is sent unchanged and a rounded player response is displayed honestly', () => {
  const h = session();
  h.changePlaybackRate(.7);
  assert.deepEqual(h.requested, [.7]);
  assert.deepEqual(h.displayed, []);
  h.changed({ data: .7 });
  assert.deepEqual(h.displayed, [.7]);
  h.changePlaybackRate(.65);
  h.changed({ data: .75 });
  assert.deepEqual(h.displayed, [.7, .75]);
});

test('directly entered speeds are not restricted to the old dropdown presets', () => {
  const h = session(); h.changePlaybackRate(.72);
  assert.deepEqual(h.requested, [.72]);
  const limited = session({ rates: [.5, 1] }); limited.changePlaybackRate(.45);
  assert.deepEqual(limited.requested, []);
});
