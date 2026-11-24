const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('app/score-sync/count-in.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function harness({ unavailable = false, fetchFails = false, resumeFails = false } = {}) {
  let now = 0, requests = 0;
  const sources = [];
  const audio = {
    currentTime: 10, state: 'running', destination: {},
    resume: () => resumeFails ? Promise.reject(Error('blocked')) : Promise.resolve(),
    decodeAudioData: async buffer => buffer,
    createBufferSource: () => {
      const source = { connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  };
  const window = { AudioContext: class { constructor() { if (unavailable) throw Error('unsupported'); return audio; } } };
  const exports = {};
  new Function('exports', 'window', 'performance', 'fetch', code)(exports, window, { now: () => now }, async url => {
    requests++;
    return { ok: !fetchFails, arrayBuffer: async () => url };
  });
  return { ...exports, audio, sources, time: value => { now = value; }, requests: () => requests };
}

test('schedules each female voice sample exactly one second apart, using the same clock for visuals', async () => {
  for (const seconds of [1, 2, 3, 4]) {
    const h = harness();
    await Promise.all([h.prepareCountIn(), h.prepareCountIn()]);
    assert.equal(h.requests(), 4);
    const elapsed = h.startCountIn(seconds);
    assert.equal(h.sources.length, seconds);
    assert.deepEqual(h.sources.map(s => s.buffer), ['one', 'two', 'three', 'four'].slice(0, seconds).map(word => `/audio/count-in/${word}.wav`));
    h.sources.forEach((s, i) => assert.equal(s.at, 10.05 + i));
    h.time(9999); // Delayed JS callbacks cannot move the audio schedule.
    h.audio.currentTime = 12.55;
    assert.ok(Math.abs(elapsed() - 2500) < .001);
    assert.equal(h.sources.length, seconds);
    h.stopCountIn();
    assert.ok(h.sources.every(s => s.stopped));
  }
});

test('zero seconds schedules no sound; replacing a countdown stops all old sounds', async () => {
  const h = harness(); await h.prepareCountIn();
  h.startCountIn(4);
  const old = [...h.sources];
  const elapsed = h.startCountIn(0);
  assert.ok(old.every(s => s.stopped));
  assert.equal(h.sources.length, 4);
  h.time(500); assert.equal(elapsed(), 500);
  h.startCountIn(2);
  assert.equal(h.sources.length, 6);
});

test('unsupported audio, missing assets, and blocked audio retain a visual clock without throwing', async () => {
  for (const options of [{ unavailable: true }, { fetchFails: true }, { resumeFails: true }]) {
    const h = harness(options); await h.prepareCountIn();
    const elapsed = h.startCountIn(4);
    await new Promise(resolve => setImmediate(resolve));
    h.time(2500);
    assert.equal(elapsed(), 2500);
    assert.ok(h.sources.every(s => s.stopped));
    assert.doesNotThrow(h.stopCountIn);
  }
});

test('late resume rejection from a cancelled countdown cannot stop its replacement', async () => {
  const h = harness(); await h.prepareCountIn();
  let reject;
  h.audio.resume = () => new Promise((_, fail) => { reject = fail; });
  h.startCountIn(4);
  h.audio.resume = () => Promise.resolve();
  h.startCountIn(2);
  reject(Error('cancelled'));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.sources.slice(0, 4).every(s => s.stopped));
  assert.ok(h.sources.slice(4).every(s => !s.stopped));
});

test('pending resume and synchronous scheduling failures never block visual countdown or leave queued speech', async () => {
  for (const fails of [true, false]) {
    const h = harness(); await h.prepareCountIn();
    if (fails) h.audio.createBufferSource = () => { throw Error('audio closed'); };
    else {
      h.audio.state = 'suspended';
      h.audio.resume = () => new Promise(() => {});
    }
    const elapsed = h.startCountIn(4);
    h.time(550);
    assert.equal(elapsed(), 550);
    assert.ok(h.sources.every(s => s.stopped));
    h.audio.state = 'running'; h.audio.currentTime = 30;
    h.time(1000); assert.equal(elapsed(), 1000);
  }
});

test('legacy or invalid saved durations default to four, including preserving zero', () => {
  const { countInSecondsOrDefault: value } = harness();
  for (const seconds of [0, 1, 2, 3, 4]) assert.equal(value(seconds), seconds);
  for (const invalid of [undefined, null, '', '2', -1, 5, 1.5, NaN, Infinity]) assert.equal(value(invalid), 4);
});

test('count-in selection saves the setting with the song', () => {
  const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/score-sync/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'select') {
      const props = node.attributes.properties;
      if (props.some(p => p.name?.getText(source) === 'value' && p.initializer?.expression?.getText(source) === 'countInSeconds')) {
        handler = props.find(p => p.name?.getText(source) === 'onChange').initializer.expression.getText(source);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const saved = [], displayed = [];
  const change = new Function('setCountInSeconds', 'storeMetadata', 'countInSecondsOrDefault', `return (${handler});`)(v => displayed.push(v), v => saved.push(v), harness().countInSecondsOrDefault);
  for (const value of ['0', '1', '2', '3', '4']) change({ target: { value } });
  assert.deepEqual(displayed, [0, 1, 2, 3, 4]);
  assert.deepEqual(saved, displayed.map(countInSeconds => ({ countInSeconds })));
  assert.match(source.text, /setCountInSeconds\(countInSecondsOrDefault\(savedSong\?\.countInSeconds\)\)/);
});
