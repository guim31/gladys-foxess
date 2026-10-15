// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the API key, at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS } from '../src/foxess/client.js';
import { API_KEY, SN_HYBRID, createWorld } from './helpers/world.js';

const MINUTE = 60_000;

/** Capture the lines of the SDK logger at LOG_LEVEL=`level`. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  t.mock.method(console, 'info', record('out'));
  t.mock.method(console, 'debug', record('out'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('FoxESS Cloud connected')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 30; i += 1) {
    w.cloud.setVariable(SN_HYBRID, 'pvPower', 1 + i / 10);
    w.clock.advance(5 * MINUTE); // past the 15-minute and hourly reads too
    await w.hub.refresh();
  }
  assert.deepEqual(logs.texts(), []);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.cloud.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(5 * MINUTE);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.cloud.online = true;
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again/);
});

test('a production read that keeps failing is logged once per inverter', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { created: [SN_HYBRID] });
  logs.clear();
  w.cloud.failOn(PATHS.generation, 41200, { sticky: true });
  for (let i = 0; i < 8; i += 1) {
    w.clock.advance(15 * MINUTE);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Production of …0001: not read/);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.gladys.publishChangedStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(5 * MINUTE);
    await w.hub.refresh();
  }
  // One line per inverter, not one per cycle.
  assert.equal(logs.lines.length, 2, logs.texts().join('\n'));
  assert.ok(logs.lines.every((line) => /States of .* refused/.test(line.text)));
});

test('a user action is one info line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { allow_control: true } });
  logs.clear();
  await w.gladys.fake.action('test_connection', {});
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
});

test('the API key never reaches the logs, even at debug and on refusals', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  w.cloud.online = false;
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  w.cloud.online = true;
  w.cloud.apiKey = 'another-key';
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  await w.gladys.fake.action('test_connection', {});
  await w.gladys.fake.configUpdated({ api_key: 'a-second-secret-key', language: 'en' });
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\]/, 'debug lines are written');
  assert.ok(!text.includes(API_KEY), 'never the API key');
  assert.ok(!text.includes('a-second-secret-key'), 'never the new API key');
  for (const request of w.cloud.requests) {
    assert.ok(!text.includes(request.headers.signature), 'never a signature');
  }
});
