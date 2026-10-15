import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseSerialNumbers } from '../src/config.js';

test('the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    apiKey: '',
    serialNumbers: [],
    refreshMs: 5 * 60_000,
    pvStrings: 0,
    allowControl: false,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(null), normalizeConfig(DEFAULT_CONFIG));
});

test('values typed or sent as strings by the form', () => {
  const config = normalizeConfig({
    api_key: '  abc-123 \n',
    serial_numbers: '60bh50000000001; 60T1000000000002,60BH50000000001\nbad!',
    refresh_minutes: 15,
    pv_strings: '3',
    allow_control: 'true',
    language: 'es',
  });
  assert.equal(config.apiKey, 'abc-123');
  assert.deepEqual(config.serialNumbers, ['60BH50000000001', '60T1000000000002']);
  assert.equal(config.refreshMs, 15 * 60_000);
  assert.equal(config.pvStrings, 3);
  assert.equal(config.allowControl, true);
  assert.equal(config.language, 'es');
});

test('out-of-range values fall back on the defaults', () => {
  const config = normalizeConfig({
    refresh_minutes: '1',
    pv_strings: 40,
    language: 'it',
    allow_control: 1,
  });
  assert.equal(config.refreshMs, 5 * 60_000, 'faster than 5 minutes is not offered');
  assert.equal(config.pvStrings, 0);
  assert.equal(config.language, 'fr');
  assert.equal(config.allowControl, false);
  assert.deepEqual(parseSerialNumbers(42), []);
});
