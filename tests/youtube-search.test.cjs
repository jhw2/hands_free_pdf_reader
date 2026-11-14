const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('app/api/youtube/search/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route(key, fetch) {
  const exports = {};
  new Function('exports', 'process', 'fetch', compiled)(exports, { env: { YOUTUBE_API_KEY: key } }, fetch);
  return q => exports.GET(new Request(`https://example.com/api/youtube/search?q=${encodeURIComponent(q)}`));
}
test('validates query and reports missing configuration without requesting YouTube', async () => {
  const get = route('', () => assert.fail('must not fetch'));
  assert.equal((await get('')).status, 400);
  assert.equal((await get('a'.repeat(121))).status, 400);
  assert.equal((await get('어른')).status, 503);
});
test('searches embeddable videos and returns only valid public fields', async () => {
  const get = route('secret', async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('q'), '최예근 어른');
    assert.equal(params.get('videoEmbeddable'), 'true');
    assert.equal(params.get('type'), 'video');
    return Response.json({ items: [{ id: { videoId: 'dQdc9DjtgQQ' }, snippet: { title: '어른', channelTitle: 'Artist' } }, { id: { videoId: 'invalid' } }] });
  });
  assert.deepEqual(await (await get('최예근 어른')).json(), { videos: [{ id: 'dQdc9DjtgQQ', title: '어른', channel: 'Artist' }] });
});
test('handles quota failures, network errors, empty and malformed responses', async () => {
  for (const fetch of [async () => new Response('secret', { status: 403 }), async () => { throw new Error('secret'); }, async () => Response.json({})]) {
    const response = await route('secret', fetch)('어른');
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('secret'));
  }
  assert.deepEqual(await (await route('secret', async () => Response.json({ items: [] }))('어른')).json(), { videos: [] });
});
test('title input debounces search and discards responses after cleanup', async () => {
  const code = ts.transpileModule(fs.readFileSync('app/score-sync/youtube-search.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let effect, timer, result, resolve, signal;
  const exports = {};
  const hooks = { useState: initial => [initial, value => { result = value; }], useEffect: callback => { effect = callback; } };
  const requireMock = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx: () => null, jsxs: () => null } : {};
  new Function('exports', 'require', 'fetch', 'setTimeout', 'clearTimeout', code)(exports, requireMock,
    (_url, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); },
    (callback, delay) => { assert.equal(delay, 700); timer = callback; return 1; }, () => {});
  const props = { value: '어른', disabled: false, isLink: false, onChange() {}, onConnect() {} };
  exports.default(props);
  const cleanup = effect();
  const pending = timer();
  cleanup();
  assert.equal(signal.aborted, true);
  resolve(Response.json({ videos: [{ id: 'dQdc9DjtgQQ' }] }));
  await pending;
  assert.equal(result, null);
  exports.default(props);
  effect();
  const second = timer();
  resolve(Response.json({ videos: [] }));
  await second;
  assert.deepEqual(result, { query: '어른', videos: [], error: '' });
  timer = null;
  exports.default({ ...props, isLink: true });
  effect();
  assert.equal(timer, null);
});
