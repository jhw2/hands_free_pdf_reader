const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function compileFile(path, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), js)(name => dependencies[name] ?? require(name), module, module.exports, ...Object.values(globals));
  return module.exports;
}
const i18n = compileFile(require.resolve('../lib/i18n.ts'), {
  './score-i18n': compileFile(require.resolve('../lib/score-i18n.ts')),
  './score-controls-i18n': compileFile(require.resolve('../lib/score-controls-i18n.ts')),
});
const locale = compileFile(require.resolve('../lib/locale.ts'));

for (const language of ['ko', 'ko-KR', 'ko-kr', 'KO-KR']) {
  test(`Korean browser language ${language} defaults to Korean`, () => assert.equal(i18n.resolveLanguage(null, language), 'ko'));
}
for (const language of ['en', 'en-US', 'ja-JP', 'fr-FR', '', 'kok-IN']) {
  test(`browser language ${language || '(empty)'} defaults to English`, () => assert.equal(i18n.resolveLanguage(null, language), 'en'));
}

test('a manual language choice overrides the browser on the next visit', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  i18n.saveLanguage('en', storage);
  assert.equal(i18n.readLanguage('ko-KR', storage), 'en');
  i18n.saveLanguage('ko', storage);
  assert.equal(i18n.readLanguage('en-US', storage), 'ko');
});

test('invalid saved values fall back to the browser language', () => {
  assert.equal(i18n.resolveLanguage('ja', 'ko-KR'), 'ko');
  assert.equal(i18n.resolveLanguage('null', 'en-US'), 'en');
});

test('blocked browser storage does not prevent choosing a language', () => {
  const storage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(i18n.readLanguage('ko-KR', storage), 'ko');
  assert.equal(i18n.readLanguage('ja-JP', storage), 'en');
  assert.doesNotThrow(() => i18n.saveLanguage('en', storage));
});

test('dynamic durations and filenames are substituted without modifying user content', () => {
  assert.equal(i18n.translate('en', '{seconds}초 유지', { seconds: '0.5' }), 'Hold for 0.5 s');
  assert.equal(i18n.translate('ko', '{seconds}초 유지', { seconds: '0.5' }), '0.5초 유지');
  assert.equal(i18n.translate('en', '{name} 삭제', { name: '내 악보 {page}.pdf' }), 'Delete 내 악보 {page}.pdf');
});

test('the complete initial UI and usage dialog render in English', () => {
  const { default: Home } = compileFile(require.resolve('../app/page.tsx'), {
    '../lib/use-language': { useLanguage: () => ({ language: 'en', chooseLanguage: () => {}, t: (text, values) => i18n.translate('en', text, values) }) },
  });
  const html = renderToStaticMarkup(React.createElement(Home));
  assert.ok(html.includes('Open a PDF score'));
  assert.ok(html.includes('How to use'));
  assert.ok(html.includes('Hold for 0.5 s'));
  assert.ok(html.includes('Try it yourself'));
  assert.ok(html.includes('Your score stays on the same page during practice.'));
  assert.ok(!html.includes('Recent scores'));
  assert.doesNotMatch(html.replaceAll('한국어', ''), /[가-힣]/);
});

test('server rendering defaults to Korean before browser preferences are available', () => {
  const language = compileFile(require.resolve('../lib/use-language.ts'), { './i18n': i18n, './locale': locale });
  const { default: Home } = compileFile(require.resolve('../app/page.tsx'), {
    '../lib/use-language': language,
  });
  const html = renderToStaticMarkup(React.createElement(Home));
  assert.ok(html.includes('PDF 악보 열기'));
  assert.ok(html.includes('0.5초 유지'));
  assert.ok(html.includes('직접 해보기'));
});

test('all literal translation keys used in the UI have English messages', () => {
  const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const missing = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && ts.isStringLiteral(node.arguments[0])) {
      if (!Object.hasOwn(i18n.english, node.arguments[0].text)) missing.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(missing, []);
});

test('current recognition and error messages also have English translations', () => {
  const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const missing = [];
  const messageCalls = new Set(['updateGestureText', 'showTemporaryGestureText', 'setDetectionStatus', 'setStorageError', 'setRenderError']);
  function visit(node) {
    if (ts.isStringLiteral(node) && /[가-힣]/.test(node.text)) {
      let parent = node.parent;
      while (parent && !ts.isCallExpression(parent) && !ts.isVariableDeclaration(parent)) parent = parent.parent;
      if (parent && ts.isCallExpression(parent) && messageCalls.has(parent.expression.getText(source))) {
        if (!Object.hasOwn(i18n.english, node.text)) missing.push(node.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(missing, []);
});


function languageProvider({ pathname = '/ko', initialLanguage = 'ko', stored = null, blocked = false, blockedCookie = false } = {}) {
  const data = new Map(stored === null ? [] : [[i18n.LANGUAGE_STORAGE_KEY, stored]]);
  const attributes = { content: 'Server page description' };
  const document = {
    documentElement: { lang: initialLanguage }, title: 'Server page title',
    querySelector: () => ({ setAttribute: (name, value) => { attributes[name] = value; } }),
  };
  let cookie = '';
  Object.defineProperty(document, 'cookie', {
    get: () => cookie,
    set: value => { if (blockedCookie) throw Error('cookie blocked'); cookie = value; },
  });
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const window = {
    get localStorage() { if (blocked) throw Error('storage blocked'); return storage; },
    location: { protocol: 'https:', search: '?source=test', hash: '#practice' },
  };
  const replacements = [];
  const router = { replace: (url, options) => { replacements.push({ url, options }); pathname = new URL(url, 'https://example.com').pathname; } };
  const { LanguageProvider } = compileFile(require.resolve('../lib/use-language.ts'), {
    react: { ...React, useEffect: callback => callback() }, './i18n': i18n, './locale': locale,
    'next/navigation': { usePathname: () => pathname, useRouter: () => router },
  }, { window, document });
  return {
    render: () => LanguageProvider({ initialLanguage, children: null }).props.value,
    navigate: value => { pathname = value; }, data, document, attributes, replacements,
  };
}

test('language switching preserves the current page, query and hash and saves the preference', () => {
  const h = languageProvider({ pathname: '/ko/score-sync' });
  let hook = h.render();
  assert.equal(hook.language, 'ko');
  assert.equal(h.document.documentElement.lang, 'ko');
  assert.equal(hook.t('얼굴을 찾고 있어요'), '얼굴을 찾고 있어요');
  hook.chooseLanguage('en');
  hook = h.render();
  assert.equal(hook.language, 'en');
  assert.equal(h.document.documentElement.lang, 'en');
  assert.equal(hook.t('얼굴을 찾고 있어요'), 'Looking for your face…');
  assert.equal(h.data.get(i18n.LANGUAGE_STORAGE_KEY), 'en');
  assert.match(h.document.cookie, /^reader-language=en; Path=\/;.*SameSite=Lax; Secure$/);
  assert.deepEqual(h.replacements, [{ url: '/en/score-sync?source=test#practice', options: { scroll: false } }]);
  assert.equal(h.document.title, 'Server page title');
  assert.equal(h.attributes.content, 'Server page description');
});

test('client route transitions change the language without overwriting server metadata', () => {
  const h = languageProvider({ pathname: '/en', initialLanguage: 'en' });
  assert.equal(h.render().language, 'en');
  assert.equal(h.document.documentElement.lang, 'en');
  assert.equal(h.document.title, 'Server page title');
  assert.equal(h.attributes.content, 'Server page description');
  h.navigate('/ko/score-sync');
  assert.equal(h.render().language, 'ko');
  assert.equal(h.document.documentElement.lang, 'ko');
  assert.equal(h.document.title, 'Server page title');
  assert.equal(h.attributes.content, 'Server page description');
});

test('an explicit locale URL takes precedence over stored preferences and stale root layout props', () => {
  const h = languageProvider({ pathname: '/ko/score-sync', initialLanguage: 'en', stored: 'en' });
  assert.equal(h.render().language, 'ko');
  assert.equal(h.document.documentElement.lang, 'ko');
  assert.deepEqual(h.replacements, []);
});

test('language navigation still works when localStorage and cookies are blocked', () => {
  const h = languageProvider({ blocked: true, blockedCookie: true });
  let hook = h.render();
  assert.equal(hook.language, 'ko');
  assert.doesNotThrow(() => hook.chooseLanguage('en'));
  hook = h.render();
  assert.equal(hook.t('사용법'), 'How to use');
  assert.equal(h.document.documentElement.lang, 'en');
});

test('the provider renders English on the server for an explicit English URL', () => {
  const language = compileFile(require.resolve('../lib/use-language.ts'), {
    './i18n': i18n, './locale': locale,
    'next/navigation': { usePathname: () => '/en', useRouter: () => ({ replace() {} }) },
  });
  const { default: Home } = compileFile(require.resolve('../app/page.tsx'), { '../lib/use-language': language });
  const html = renderToStaticMarkup(React.createElement(language.LanguageProvider, { initialLanguage: 'en' }, React.createElement(Home)));
  assert.ok(html.includes('Open a PDF score'));
  assert.ok(html.includes('href="/en/score-sync"'));
  assert.doesNotMatch(html.replaceAll('한국어', ''), /[가-힣]/);
});
