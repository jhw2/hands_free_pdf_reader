const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)) functions.set(node.name.getText(source), node.initializer.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
function actual(name, bindings) {
  assert.ok(functions.has(name));
  const js = ts.transpileModule(`const run = ${functions.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn run;`)(...Object.values(bindings));
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function storage(write = async () => {}) {
  const env = {
    storageWriteQueueRef: { current: Promise.resolve() }, savedScoresRef: { current: [] },
    currentPdfBlobRef: { current: 'pdf-data' }, currentFileNameRef: { current: 'score.pdf' },
    currentPageRef: { current: 1 }, currentSavedScoreIdRef: { current: 'a' },
    practiceRef: { current: { active: false } }, pdfDocRef: { current: {} }, pageCountRef: { current: 10 },
    SAVED_SCORES_KEY: 'scores', SESSION_STATE_KEY: 'session', writeReaderValue: write,
    setSavedScores: () => {}, setCurrentPage: () => {}, renderPage: async () => {},
    updateGestureText: () => {}, console: { error: () => {} },
  };
  let error = null;
  env.setStorageError = value => { error = value; };
  for (const name of ['persistReaderValue', 'saveSessionState', 'saveScoresToDb', 'queuePage', 'retryStorage']) env[name] = actual(name, env);
  return { env, error: () => error };
}

test('an existing camera handler saves the latest library, including newly opened scores', async () => {
  const writes = [];
  const { env } = storage(async (key, value) => writes.push([key, value]));
  const oldCameraQueue = env.queuePage;
  await env.saveScoresToDb([{ id: 'a', currentPage: 1 }, { id: 'b', currentPage: 4 }]);
  oldCameraQueue(2);
  await env.storageWriteQueueRef.current;
  assert.deepEqual(writes.at(-1)[1].map(score => [score.id, score.currentPage]), [['a', 2], ['b', 4]]);
});

test('camera page turns do not bring back a deleted score', async () => {
  const { env } = storage();
  const oldCameraQueue = env.queuePage;
  await env.saveScoresToDb([{ id: 'a', currentPage: 1 }, { id: 'b', currentPage: 1 }]);
  await env.saveScoresToDb([{ id: 'a', currentPage: 1 }]);
  oldCameraQueue(3);
  await env.storageWriteQueueRef.current;
  assert.deepEqual(env.savedScoresRef.current.map(score => score.id), ['a']);
});

test('storage writes stay in order when an earlier write is slow', async () => {
  const gate = deferred();
  const writes = [];
  const { env } = storage(async (_key, value) => {
    writes.push(value);
    if (value === 1) await gate.promise;
  });
  const first = env.persistReaderValue('scores', 1);
  const second = env.persistReaderValue('scores', 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [1]);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(writes, [1, 2]);
});

test('failed storage keeps the in-memory library and retry saves it successfully', async () => {
  let fail = true;
  const writes = [];
  const harness = storage(async (key, value) => {
    if (fail) throw Error('storage full');
    writes.push([key, value]);
  });
  const scores = [{ id: 'a', currentPage: 4 }];
  assert.equal(await harness.env.saveScoresToDb(scores), false);
  assert.equal(harness.env.savedScoresRef.current, scores);
  assert.ok(harness.error());
  fail = false;
  await harness.env.retryStorage();
  assert.equal(harness.error(), null);
  assert.deepEqual(writes.map(([key]) => key), ['scores', 'session']);
  assert.deepEqual(writes[0][1], scores);
});

function renderer(pdf) {
  const errors = [], shown = [];
  const env = {
    pdfDocRef: { current: pdf }, canvasRef: { current: { getContext: () => ({}) } },
    pendingRenderRef: { current: null }, renderPromiseRef: { current: null },
    setRenderError: value => errors.push(value), setPageText: value => shown.push(value),
    console: { error: () => {} },
  };
  return { env, errors, shown, render: actual('renderPage', env) };
}
const page = (promise = Promise.resolve()) => ({ getViewport: () => ({ width: 100, height: 200 }), render: () => ({ promise }) });

test('a page loading failure releases the worker and the same page can be retried', async () => {
  let fail = true;
  const pdf = { getPage: async () => { if (fail) throw Error('bad page'); return page(); } };
  const h = renderer(pdf);
  await h.render(pdf, 2, 5);
  assert.equal(h.env.renderPromiseRef.current, null);
  assert.ok(h.errors.at(-1));
  fail = false;
  await h.render(pdf, 2, 5);
  assert.equal(h.errors.at(-1), null);
  assert.deepEqual(h.shown, ['페이지: 2 / 5']);
});

test('a failed canvas render still processes the next queued page', async () => {
  const gate = deferred();
  const pdf = { getPage: async number => page(number === 1 ? gate.promise.then(() => { throw Error('render failed'); }) : Promise.resolve()) };
  const h = renderer(pdf);
  const first = h.render(pdf, 1, 5);
  await new Promise(resolve => setImmediate(resolve));
  const next = h.render(pdf, 2, 5);
  gate.resolve();
  await Promise.all([first, next]);
  assert.deepEqual(h.shown, ['페이지: 2 / 5']);
  assert.equal(h.errors.at(-1), null);
  assert.equal(h.env.renderPromiseRef.current, null);
});

test('switching PDFs while loading a page renders the new document', async () => {
  const gate = deferred();
  let oldPainted = false;
  const oldPdf = { getPage: async () => { await gate.promise; return { ...page(), render: () => { oldPainted = true; return { promise: Promise.resolve() }; } }; } };
  const newPdf = { getPage: async () => page() };
  const h = renderer(oldPdf);
  const oldRequest = h.render(oldPdf, 1, 5);
  await new Promise(resolve => setImmediate(resolve));
  h.env.pdfDocRef.current = newPdf;
  const newRequest = h.render(newPdf, 3, 7);
  gate.resolve();
  await Promise.all([oldRequest, newRequest]);
  assert.equal(oldPainted, false);
  assert.deepEqual(h.shown, ['페이지: 3 / 7']);
});

test('an unavailable canvas releases the worker for a later retry', async () => {
  const pdf = { getPage: async () => page() };
  const h = renderer(pdf);
  h.env.canvasRef.current.getContext = () => null;
  await h.render(pdf, 1, 5);
  assert.ok(h.errors.at(-1));
  h.env.canvasRef.current.getContext = () => ({});
  await h.render(pdf, 1, 5);
  assert.equal(h.errors.at(-1), null);
});
