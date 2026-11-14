const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function compile(file, dependencies = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', js)(name => dependencies[name] ?? require(name), exports);
  return exports;
}
const locale = compile('lib/locale.ts');
const { middleware } = compile('middleware.ts', { './lib/locale': locale });

test('language negotiation respects the saved choice, browser priority and English fallback', () => {
  for (const [saved, header, expected] of [
    ['ko', 'en-US', 'ko'], ['en', 'ko-KR', 'en'], ['invalid', 'ko-KR, en;q=0.8', 'ko'],
    [undefined, 'en-US,ko;q=0.7', 'en'], [undefined, 'ja-JP,ko;q=0.7', 'en'],
    [undefined, 'en;q=0.5,ko-KR;q=0.9', 'ko'], [undefined, 'ko;q=0,en', 'en'],
    [undefined, 'ko;q=invalid,en', 'en'], [undefined, 'kok-IN', 'en'], [undefined, null, 'en'],
  ]) assert.equal(locale.preferredLanguage(saved, header), expected);
});

test('neutral entry URLs redirect temporarily without caching language choices or losing queries', () => {
  for (const [pathname, cookie, accept, destination] of [
    ['/', '', 'fr-FR', '/en'], ['/score-sync', '', 'ko-KR', '/ko/score-sync'],
    ['/score-sync', 'reader-language=ko', 'en-US', '/ko/score-sync'], ['/', '', '', '/en'],
  ]) {
    const request = new NextRequest(`https://example.com${pathname}?source=link`, { headers: { cookie, 'accept-language': accept } });
    const response = middleware(request);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `https://example.com${destination}?source=link`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('vary'), 'Accept-Language, Cookie');
  }
});

test('explicit language URLs never redirect and cannot be overridden with a spoofed language header', () => {
  for (const pathname of ['/ko', '/ko/score-sync', '/en', '/en/score-sync']) {
    const language = pathname.split('/')[1];
    const other = language === 'ko' ? 'en' : 'ko';
    const request = new NextRequest(`https://example.com${pathname}`, {
      headers: { cookie: `reader-language=${other}`, 'accept-language': other, 'x-site-language': other, 'user-agent': 'Googlebot' },
    });
    const response = middleware(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('x-middleware-request-x-site-language'), language);
  }
});

test('locale parsing only accepts complete supported path segments', () => {
  assert.equal(locale.languageFromPathname('/en/score-sync'), 'en');
  for (const pathname of [null, '/', '/score-sync', '/english', '/fr']) assert.equal(locale.languageFromPathname(pathname), null);
  assert.equal(locale.localizedPath('/ko/score-sync', 'en'), '/en/score-sync');
  assert.equal(locale.localizedPath('/en', 'ko'), '/ko');
  assert.equal(locale.localizedPath('/', 'en'), '/en');
});
