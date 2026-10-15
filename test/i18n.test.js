// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of
// the code, the feature names, the four documentation pages (same sections).
// German says "du", never the polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { MESSAGES, NAMES, TEXT, thrown } from '../src/texts.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, and the catalog description long enough', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every fixed text and message of the code has the four languages', () => {
  // The texts shown in a status row or a tile are short; the others are messages.
  const short = new Set([
    'offline',
    'alarmStatus',
    'online',
    'selfTest',
    'waiting',
    'checking',
    'onGrid',
    'offGrid',
    'fault',
    'permanentFault',
    'standby',
    'upgrading',
    'fct',
    'illegal',
    'noAlarm',
    'SelfUse',
    'Feedin',
    'Backup',
    'solar',
    'house',
    'gridImport',
    'gridExport',
    'battery',
    'today',
    'inverter',
    'workMode',
    'minSoc',
    'updated',
    'idle',
  ]);
  const found = Object.entries(TEXT).flatMap(([key, value]) =>
    problems(value, `TEXT.${key}`, short.has(key) ? 24 : MAX.message),
  );
  const samples = {
    faults: [3],
    charging: ['1.2 kW'],
    discharging: ['850 W'],
    minSoc: [10, 20],
    modeSet: ['Feedin'],
    minSocSet: [15, 30],
    serialsMissing: ['60BH50000000001, 60T1000000000002'],
    testOk: ['H1-5.0-E (60BH50000000001), T10-G3 (60T1000000000002)', '1203 / 1440'],
    testFailed: [TEXT.keyRefused],
  };
  assert.deepEqual(sorted(Object.keys(samples)), sorted(Object.keys(MESSAGES)));
  for (const [key, args] of Object.entries(samples)) {
    found.push(...problems(MESSAGES[key](...args), `MESSAGES.${key}`, MAX.message));
  }
  assert.deepEqual(found, []);
});

test('a thrown message carries the four languages', () => {
  const text = thrown(TEXT.controlDisabled, 'detail');
  for (const lang of LANGS) {
    assert.ok(text.includes(TEXT.controlDisabled[lang]));
  }
  assert.ok(text.length <= 300);
});

test('the feature names exist in every language, with the same keys', () => {
  const found = [];
  for (const lang of LANGS) {
    assert.deepEqual(sorted(Object.keys(NAMES[lang])), sorted(Object.keys(NAMES.en)), lang);
    for (const [key, value] of Object.entries(NAMES[lang])) {
      found.push(
        ...textProblems(value.replace('{n}', '18'), `NAMES.${lang}.${key}`, lang, MAX.featureName),
      );
    }
  }
  assert.deepEqual(found, []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Solar', fr: 'Solaire', de: 'Solar' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Gerät',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

/** The heading levels of a page, in order: the shape of its sections. */
const outline = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation pages have the same sections', () => {
  for (const lang of LANGS) {
    assert.deepEqual(outline(docs[lang]), outline(docs.en), `docs/${lang}.md`);
  }
  assert.ok(outline(docs.en).length >= 10, 'presentation, prerequisites, configuration, ...');
});

test('every documentation page says it was developed without the hardware, and the quota', () => {
  const said = {
    en: /without the hardware/i,
    fr: /sans le matériel/i,
    de: /ohne die Hardware/i,
    es: /sin el hardware/i,
  };
  for (const lang of LANGS) {
    assert.match(docs[lang], said[lang], `docs/${lang}.md`);
    assert.match(docs[lang], /1[ .,\u202f]?440/, `docs/${lang}.md: the daily quota`);
    assert.ok(!POLITE_GERMAN.test(lang === 'de' ? docs.de : ''), 'German docs say "du"');
  }
});

test('the documentation names every feature, trigger and action of the integration', () => {
  for (const lang of LANGS) {
    for (const key of ['inverter_fault', 'set_work_mode', 'set_min_soc', 'test_connection']) {
      // The scene editor shows the labels, the docs name them.
      const label = [
        ...manifest.scene_triggers,
        ...manifest.scene_actions,
        ...manifest.actions,
      ].find((x) => x.key === key).label[lang];
      assert.ok(docs[lang].includes(label), `docs/${lang}.md does not name "${label}"`);
    }
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(
        docs[lang].includes(name.replace(' {n}', '')),
        `docs/${lang}.md does not name "${name}"`,
      );
    }
  }
});
