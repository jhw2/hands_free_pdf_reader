const assert = require('node:assert/strict');
assert.ok(process.argv[2], 'Usage: node tests/seo-build.cjs <running production server URL>');
const server = process.argv[2];
const origin = 'https://musicup.space';
const get = (route, headers = {}) => fetch(new URL(route, server), { redirect: 'manual', headers });
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/g, entity => ({
  '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'",
})[entity]);
const attributes = tag => Object.fromEntries([...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)]
  .map(([, name, value]) => [name.toLowerCase(), decode(value ?? '')]));
const text = html => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function visibleBody(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)?.[1];
  assert.ok(body, 'server HTML must contain a body');
  const markup = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  let visible = '';
  for (const [token, closing, name] of markup.matchAll(/<(\/)?([a-z][\w-]*)\b[^>]*>|[^<]+/gi)) {
    if (!name) { if (!stack.at(-1)?.hidden) visible += token; continue; }
    if (closing) {
      const opened = stack.pop();
      assert.equal(opened?.name, name, 'unexpected server HTML nesting');
      if (!opened.hidden) visible += token;
      continue;
    }
    const attrs = attributes(token);
    const hidden = stack.at(-1)?.hidden || 'hidden' in attrs || attrs['aria-hidden'] === 'true'
      || /(?:^|\s)sr-only(?:\s|$)/.test(attrs.class ?? '') || (name === 'dialog' && !('open' in attrs));
    if (!hidden) visible += token;
    if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)) stack.push({ name, hidden });
  }
  return visible;
}

async function check() {
const pages = [];
for (const page of [
  { route: '/ko', language: 'ko', h1: /입으로 넘기는.*악보/, description: /입을 벌리고.*페이지로 넘어갑니다/, link: '/ko/score-sync' },
  { route: '/ko/score-sync', language: 'ko', h1: /YouTube.*PDF 악보 연습/, description: /PDF 악보의 마디를 음악에 맞춰 표시/, link: '/ko' },
  { route: '/en', language: 'en', h1: /Hands-Free Score Reader/, description: /Open your mouth.*next page/, link: '/en/score-sync' },
  { route: '/en/score-sync', language: 'en', h1: /Practice with YouTube.*PDF score/, description: /Follow the highlighted measure/, link: '/en' },
]) {
  const response = await get(page.route, { 'Accept-Language': page.language === 'ko' ? 'en-US' : 'ko-KR', Cookie: `reader-language=${page.language === 'ko' ? 'en' : 'ko'}` });
  assert.equal(response.status, 200, 'explicit language URLs must not redirect based on browser or cookie');
  assert.doesNotMatch(response.headers.get('X-Robots-Tag') ?? '', /noindex|nofollow/);
  const html = await response.text();
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, `${page.route}: metadata must be present in server HTML`);
  const titles = [...head.matchAll(/<title>(.*?)<\/title>/g)];
  assert.equal(titles.length, 1, `${page.route}: one title`);
  const title = decode(titles[0][1]);
  const metas = [...head.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => attributes(tag));
  const meta = key => {
    const entries = metas.filter(entry => entry.name === key || entry.property === key);
    assert.equal(entries.length, 1, `${page.route}: one ${key}`);
    assert.ok(entries[0].content, `${page.route}: nonempty ${key}`);
    return entries[0].content;
  };
  const description = meta('description');
  const url = new URL(page.route, origin).href;
  const canonicals = [...head.matchAll(/<link\b[^>]*>/g)].map(([tag]) => attributes(tag)).filter(tag => tag.rel === 'canonical');
  assert.deepEqual(canonicals.map(tag => new URL(tag.href).href), [url], `${page.route}: canonical`);
  assert.equal(new URL(meta('og:url')).href, url);
  assert.equal(meta('og:locale'), page.language === 'ko' ? 'ko_KR' : 'en_US');
  const suffix = page.route.endsWith('/score-sync') ? '/score-sync' : '';
  const alternates = [...head.matchAll(/<link\b[^>]*>/g)].map(([tag]) => attributes(tag)).filter(tag => tag.rel === 'alternate');
  assert.deepEqual(Object.fromEntries(alternates.map(tag => [tag.hreflang, new URL(tag.href).href])), {
    ko: `${origin}/ko${suffix}`, en: `${origin}/en${suffix}`, 'x-default': `${origin}${suffix || '/'}`,
  }, `${page.route}: reciprocal language alternates`);
  for (const prefix of ['og', 'twitter']) {
    assert.equal(meta(`${prefix}:title`), title);
    assert.equal(meta(`${prefix}:description`), description);
    const image = new URL(meta(`${prefix}:image`));
    assert.equal(image.origin, origin, `${page.route}: absolute production image URL`);
    const imageResponse = await get(image.pathname);
    assert.equal(imageResponse.status, 200);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'share image is a PNG');
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
  }
  assert.equal(meta('twitter:card'), 'summary_large_image');
  for (const entry of metas.filter(tag => tag.name === 'robots')) assert.doesNotMatch(entry.content, /noindex|nofollow/);
  assert.equal(attributes(html.match(/<html\b[^>]*>/)[0]).lang, page.language);
  const visible = visibleBody(html);
  const headings = [...visible.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(headings.length, 1, `${page.route}: one visible H1 without JavaScript`);
  assert.match(text(headings[0][1]), page.h1);
  assert.ok([...visible.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].some(([, value]) => page.description.test(text(value))), `${page.route}: visible feature description`);
  assert.ok([...visible.matchAll(/<a\b[^>]*>/g)].some(([tag]) => attributes(tag).href === page.link), `${page.route}: crawlable link to the other page`);
  if (page.language === 'en') {
    assert.doesNotMatch(title + description, /[가-힣]/);
    assert.doesNotMatch(text(visible).replaceAll('한국어', ''), /[가-힣]/);
  }
  if (suffix === '/score-sync') {
    const uploads = [...visible.matchAll(/<button\b[^>]*>/g)].map(([tag]) => attributes(tag)).filter(tag => tag['data-analytics-click'] === 'score_pdf_open_click');
    assert.equal(uploads.length, 1, 'initial score view shows one upload button');
    assert.ok('disabled' in uploads[0], 'upload stays disabled while the saved library is restoring');
    assert.match(text(visible), page.language === 'ko' ? /보관함을 열고 있어요/ : /Opening your library/);
  }
  pages.push({ title, description });
}
assert.equal(new Set(pages.map(page => page.title)).size, 4, 'routes need distinct titles');
assert.equal(new Set(pages.map(page => page.description)).size, 4, 'routes need distinct descriptions');

const robots = await (await get('/robots.txt')).text();
assert.match(robots, /^User-Agent: \*$/im);
assert.match(robots, /^Allow: \/$/im);
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
assert.deepEqual([...robots.matchAll(/^Disallow:\s*(.*)$/gim)].map(([, value]) => value.trim()), ['/api/'], 'public pages and /_next/ assets remain crawlable');
const sitemapResponse = await get('/sitemap.xml');
assert.equal(sitemapResponse.status, 200);
assert.match(sitemapResponse.headers.get('content-type'), /application\/xml/);
const sitemap = await sitemapResponse.text();
assert.match(sitemap, /xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml"/);
assert.doesNotMatch(sitemap, /handsfreepdfreader\.vercel\.app/);
const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, value]) => decode(value));
assert.deepEqual(locations.sort(), ['/ko', '/en', '/ko/score-sync', '/en/score-sync'].map(route => origin + route).sort());
for (const [, entry] of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
  const location = decode(entry.match(/<loc>(.*?)<\/loc>/)[1]);
  const suffix = new URL(location).pathname.endsWith('/score-sync') ? '/score-sync' : '';
  const links = [...entry.matchAll(/<xhtml:link\b[^>]*>/g)].map(([tag]) => attributes(tag));
  assert.equal(links.length, 3);
  assert.ok(links.every(link => link.rel === 'alternate'));
  assert.deepEqual(Object.fromEntries(links.map(link => [link.hreflang, new URL(link.href).href])), {
    ko: `${origin}/ko${suffix}`, en: `${origin}/en${suffix}`, 'x-default': `${origin}${suffix || '/'}`,
  }, `${location}: sitemap language links include self and match page metadata`);
}
for (const [browser, cookie, language] of [['ko-KR, en;q=0.9', '', 'ko'], ['ja-JP, ko;q=0.5', '', 'en'], ['fr-FR', '', 'en'], ['', '', 'en'], ['en-US', 'reader-language=ko', 'ko'], ['ko-KR', 'reader-language=en', 'en']]) {
  for (const route of ['/', '/score-sync']) {
    const response = await get(`${route}?test=kept`, { 'Accept-Language': browser, Cookie: cookie });
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, `/${language}${route === '/' ? '' : route}`);
    assert.equal(destination.search, '?test=kept');
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
}
assert.equal((await get('/fr')).status, 404, 'unsupported locale must not create another indexed version');
console.log('PASS: all four language pages have localized SSR, metadata, links, images and sitemap; language negotiation preserves explicit URLs.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
