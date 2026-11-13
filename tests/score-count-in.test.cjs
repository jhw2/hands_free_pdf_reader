const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('page.tsx', fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = source.statements.filter(node => ['stopCountIn', 'speakCountIn'].includes(node.declarationList?.declarations?.[0]?.name?.text));
const js = ts.transpileModule(helpers.map(node => node.getText(source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const load = window => new Function('window', `${js}\nreturn { stopCountIn, speakCountIn };`)(window);

test('count-in uses English words and replaces queued speech rather than accumulating it', () => {
  const spoken = [], queue = [];
  const window = {
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      getVoices: () => [{ name: 'Albert', lang: 'en-US' }, { name: 'Samantha', lang: 'en-US' }],
      cancel: () => { queue.length = 0; },
      speak: utterance => { queue.push(utterance); spoken.push(utterance); },
    },
  };
  const { speakCountIn, stopCountIn } = load(window);
  for (let beat = 0; beat < 4; beat++) {
    speakCountIn(beat);
    assert.equal(queue.length, 1);
  }
  assert.deepEqual(spoken.map(item => item.text), ['One', 'Two', 'Three', 'Four']);
  assert.ok(spoken.every(item => item.lang === 'en-US' && item.rate === 1.2));
  assert.ok(spoken.every(item => item.voice.name === 'Samantha'));
  speakCountIn(4);
  assert.equal(spoken.length, 4);
  stopCountIn();
  assert.deepEqual(queue, []);
});

test('missing or failing speech synthesis does not break countdown or playback', () => {
  for (const window of [{}, {
    SpeechSynthesisUtterance: class {},
    speechSynthesis: { getVoices: () => [{ name: 'Samantha', lang: 'en-US' }], cancel: () => { throw Error('unavailable'); } },
  }, {
    SpeechSynthesisUtterance: class {},
    speechSynthesis: { getVoices: () => [{ name: 'Samantha', lang: 'en-US' }], cancel: () => {}, speak: () => { throw Error('blocked'); } },
  }]) {
    const { speakCountIn, stopCountIn } = load(window);
    assert.doesNotThrow(() => speakCountIn(0));
    assert.doesNotThrow(stopCountIn);
  }
});

test('uses another known female English voice when Samantha is not installed', () => {
  const spoken = [];
  const voice = { name: 'Microsoft Zira - English (United States)', lang: 'en-US' };
  const { speakCountIn } = load({
    SpeechSynthesisUtterance: class {},
    speechSynthesis: { getVoices: () => [{ name: 'Albert', lang: 'en-US' }, voice], cancel: () => {}, speak: item => spoken.push(item) },
  });
  speakCountIn(0);
  assert.equal(spoken[0].voice, voice);
});

test('does not fall back to Albert while female voices are absent or still loading', () => {
  let voices = [];
  const spoken = [];
  const { speakCountIn } = load({
    SpeechSynthesisUtterance: class {},
    speechSynthesis: { getVoices: () => voices, cancel: () => {}, speak: item => spoken.push(item) },
  });
  speakCountIn(0);
  voices = [{ name: 'Albert', lang: 'en-US' }, { name: 'Samantha', lang: 'fr-FR' }];
  speakCountIn(1);
  assert.deepEqual(spoken, []);
  voices.push({ name: 'Samantha', lang: 'en-US' });
  speakCountIn(2);
  assert.equal(spoken[0].voice.name, 'Samantha');
});
