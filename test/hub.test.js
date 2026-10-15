// -----------------------------------------------------------------------------
// The hub against the in-memory FoxESS Cloud: the states follow the cloud on
// the hub's own timer (never through the core's onPoll), the quota is kept,
// a refused call pauses the readings, an offline inverter publishes no stale
// value, a newly added device gets every state at once, a new fault fires the
// scene trigger.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS } from '../src/foxess/client.js';
import { FAULT_TRIGGER, TIMINGS } from '../src/hub.js';
import { TEXT } from '../src/texts.js';
import {
  SN_HYBRID,
  SN_SOLAR,
  createWorld,
  deviceId,
  featureId,
  lastValue,
} from './helpers/world.js';

const MINUTE = 60_000;

test('the states follow the cloud on the hub timer, without any onPoll from the core', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  t.mock.method(w.hub, 'pollDevice');

  assert.equal(lastValue(w.gladys, SN_HYBRID, 'pv_power'), 3412);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'battery_level'), 64);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'status'), 'On grid');
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'alarm'), 'None');
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'online'), 1);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'generation_today'), 12.7);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'generation_total'), 8123.5);
  assert.equal(lastValue(w.gladys, SN_SOLAR, 'grid_export_power'), 4800);
  assert.equal(lastValue(w.gladys, SN_SOLAR, 'battery_level'), undefined);

  w.cloud.setVariable(SN_HYBRID, 'pvPower', 1.2);
  w.cloud.setVariable(SN_HYBRID, 'SoC', 70);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh(); // what the timer runs every refresh_minutes

  assert.equal(lastValue(w.gladys, SN_HYBRID, 'pv_power'), 1200);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'battery_level'), 70);
  assert.equal(w.hub.pollDevice.mock.callCount(), 0, 'the core was never needed');
});

test('the timer itself reads again after the refresh interval', async (t) => {
  const w = await createWorld({ connect: false });
  // A real timer, with a very short interval.
  const { registerHandlers } = await import('../src/app.js');
  w.app.stop();
  const app = registerHandlers(w.gladys, {
    request: w.cloud.handle,
    timers: true,
    now: w.clock.now,
    minIntervalMs: 0,
  });
  t.after(() => app.stop());
  await w.gladys.connect();
  await app.ready;
  app.hub.config.refreshMs = 20;
  app.hub.schedule();
  const before = w.cloud.countOf(PATHS.realTime);
  w.cloud.setVariable(SN_HYBRID, 'loadsPower', 2.5);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(w.cloud.countOf(PATHS.realTime) > before, 'the timer read the cloud again');
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'load_power'), 2500);
});

test('only the changed values are published, and the unchanged ones again every 6 hours', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const count = () => w.gladys.fake.states.length;

  const before = count();
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.equal(count(), before, 'nothing changed, nothing sent');

  w.cloud.setVariable(SN_SOLAR, 'pvPower', 5.5);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.equal(count(), before + 1);

  // The heartbeat of the SDK runs on the real clock: age the remembered values.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + TIMINGS.heartbeatMs + MINUTE });
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.ok(count() > before + 20, 'every value sent again');
});

test('a day at 5 minutes keeps far below the 1,440 calls of the quota', async (t) => {
  const w = await createWorld({ created: [SN_HYBRID] });
  t.after(() => w.app.stop());
  const start = w.cloud.requests.length;
  for (let i = 0; i < 288; i += 1) {
    w.clock.advance(5 * MINUTE);
    await w.hub.refresh();
  }
  const calls = w.cloud.requests.length - start;
  // 288 real-time + 96 lists + 96 productions + 24 × 2 settings = 528.
  assert.equal(calls, 528);
  assert.equal(w.cloud.countOf(PATHS.realTime) - 1, 288);
});

test('the inverters not added to Gladys are read once, for the Discovery tab', async (t) => {
  const w = await createWorld({ created: [SN_HYBRID] });
  t.after(() => w.app.stop());
  assert.equal(w.gladys.fake.discoveredDevices.length, 2);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  const last = w.cloud.requests.filter((r) => r.path === PATHS.realTime).at(-1);
  assert.deepEqual(last.body.sns, [SN_HYBRID]);
  assert.equal(
    lastValue(w.gladys, SN_SOLAR, 'pv_power'),
    undefined,
    'no state for a device Gladys does not have',
  );
  assert.ok(!w.cloud.requests.some((r) => r.query.sn === SN_SOLAR), 'no production read for it');
});

test('a quota refusal pauses the readings for 30 minutes and says so', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.cloud.failOn(PATHS.realTime, 40400);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.deepEqual(w.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.quotaReached,
  });

  const calls = w.cloud.requests.length;
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(5 * MINUTE);
    await w.hub.refresh();
  }
  assert.equal(w.cloud.requests.length, calls, 'no call during the pause');
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.ok(w.cloud.requests.length > calls);
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: true });
});

test('a refused key shows in the Configuration screen and pauses the readings', async (t) => {
  const w = await createWorld({ config: { api_key: 'a-revoked-key' } });
  t.after(() => w.app.stop());
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: false, message: TEXT.keyRefused });
  assert.equal(w.gladys.fake.discoveredDevices.length, 0);
  const calls = w.cloud.requests.length;
  w.clock.advance(30 * MINUTE);
  await w.hub.refresh();
  assert.equal(w.cloud.requests.length, calls);

  // The user types the right key: read at once.
  await w.gladys.fake.configUpdated({ api_key: 'test-api-key-0123456789abcdef', language: 'en' });
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: true });
  assert.equal(w.gladys.fake.discoveredDevices.length, 2);
});

test('without API key, nothing is called and the screen asks for it', async (t) => {
  const w = await createWorld({ config: { api_key: '' } });
  t.after(() => w.app.stop());
  assert.equal(w.cloud.requests.length, 0);
  assert.deepEqual(w.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.notConfiguredStatus,
  });
});

test('a cloud that does not answer: unreachable, then back', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.cloud.online = false;
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: false, message: TEXT.unreachable });
  w.cloud.online = true;
  w.cloud.setVariable(SN_HYBRID, 'loadsPower', 0.9);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: true });
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'load_power'), 900);
});

test('an offline inverter publishes its status, not the stale values of the cloud', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.cloud.setStatus(SN_SOLAR, 3);
  w.cloud.setVariable(SN_SOLAR, 'pvPower', 9.9);
  w.clock.advance(15 * MINUTE); // the list is read again every 15 minutes
  await w.hub.refresh();
  assert.equal(lastValue(w.gladys, SN_SOLAR, 'online'), 0);
  assert.equal(lastValue(w.gladys, SN_SOLAR, 'status'), 'Offline');
  assert.equal(lastValue(w.gladys, SN_SOLAR, 'pv_power'), 6204, 'the stale value is not published');
});

test('a failing production read does not stop the real-time values', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.cloud.failOn(PATHS.generation, 41200, { sticky: true });
  w.cloud.setVariable(SN_HYBRID, 'pvPower', 2);
  w.cloud.setVariable(SN_HYBRID, 'todayYield', 13.9);
  w.clock.advance(15 * MINUTE);
  await w.hub.refresh();
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'pv_power'), 2000);
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: true });
});

test('the production comes from the real-time values when the generation endpoint never answered', async (t) => {
  const w = await createWorld({ connect: false });
  t.after(() => w.app.stop());
  w.cloud.failOn(PATHS.generation, 41200, { sticky: true });
  await w.gladys.connect();
  await w.app.ready;
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'generation_today'), 12.6);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'generation_total'), 8123.4);
});

test('an inverter just added to Gladys gets every state at once, without a new reading', async (t) => {
  const w = await createWorld({ created: [] });
  t.after(() => w.app.stop());
  assert.equal(w.gladys.fake.states.length, 0);
  const calls = w.cloud.requests.length;
  const device = { external_id: deviceId(w.gladys, SN_HYBRID), features: [] };
  await w.gladys.fake.deviceCreated(device);
  assert.ok(w.cloud.requests.length > calls, 'the production and settings are read for it');
  assert.equal(w.cloud.countOf(PATHS.realTime), 1, 'the real-time values were already known');
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'pv_power'), 3412);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'generation_today'), 12.7);
  assert.ok(w.gladys.fake.widgetRefreshes.includes('overview'));
});

test('a new fault fires the scene trigger once; a fault present at start-up does not', async (t) => {
  const w = await createWorld({ connect: false });
  t.after(() => w.app.stop());
  w.cloud.setVariable(SN_SOLAR, 'currentFault', 'Grid Lost Fault');
  w.cloud.setVariable(SN_SOLAR, 'currentFaultCount', 1);
  await w.gladys.connect();
  await w.app.ready;
  assert.equal(w.gladys.fake.sceneEvents.length, 0, 'already there at start-up');
  assert.equal(lastValue(w.gladys, SN_SOLAR, 'alarm'), 'Grid Lost Fault');

  w.cloud.setVariable(SN_HYBRID, 'currentFault', 'Bat Volt High');
  w.cloud.setVariable(SN_HYBRID, 'currentFaultCount', 1);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.equal(w.gladys.fake.sceneEvents.length, 1);
  const [event] = w.gladys.fake.sceneEvents;
  assert.equal(event.key ?? event.trigger_key, FAULT_TRIGGER);
  const data = event.data ?? event;
  assert.equal(data.device, deviceId(w.gladys, SN_HYBRID));
  assert.equal(data.fault, 'Bat Volt High');

  // Cleared: no event, the alarm feature says so.
  w.cloud.setVariable(SN_HYBRID, 'currentFault', '');
  w.cloud.setVariable(SN_HYBRID, 'currentFaultCount', 0);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  assert.equal(w.gladys.fake.sceneEvents.length, 1);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'alarm'), 'None');
});

test('the serial numbers of the configuration select the inverters; an unknown one is reported', async (t) => {
  const w = await createWorld({
    config: { serial_numbers: `${SN_SOLAR.toLowerCase()}, 60NOTMINE000001` },
  });
  t.after(() => w.app.stop());
  assert.deepEqual(
    w.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [deviceId(w.gladys, SN_SOLAR)],
  );
  assert.equal(w.gladys.fake.connectionStatus.connected, false);
  assert.match(w.gladys.fake.connectionStatus.message.en, /60NOTMINE000001/);
  assert.equal(lastValue(w.gladys, SN_HYBRID, 'pv_power'), undefined);
});

test('a scan request publishes the devices again', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const before = w.gladys.fake.requests.filter((r) => r.path.includes('discover')).length;
  await w.gladys.fake.scanRequest();
  const after = w.gladys.fake.requests.filter((r) => r.path.includes('discover')).length;
  assert.equal(after, before + 1);
});

test('a PV string that appears (a new reading) makes the devices published again', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.cloud.setVariable(SN_SOLAR, 'pv3Power', 0.4);
  w.clock.advance(5 * MINUTE);
  await w.hub.refresh();
  const solar = w.gladys.fake.discoveredDevices.find(
    (d) => d.external_id === deviceId(w.gladys, SN_SOLAR),
  );
  assert.ok(
    solar.features.some((f) => f.external_id === featureId(w.gladys, SN_SOLAR, 'pv3_power')),
  );
});

test('the core onPoll is a fallback: skipped right after the timer, reads when the timer stalled', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const device = { external_id: deviceId(w.gladys, SN_HYBRID) };
  const calls = w.cloud.requests.length;
  await w.gladys.fake.poll(device);
  assert.equal(w.cloud.requests.length, calls);
  w.clock.advance(10 * MINUTE);
  await w.gladys.fake.poll(device);
  assert.ok(w.cloud.requests.length > calls);
});

test('a reconnection to Gladys sends every state again', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await w.gladys.disconnect();
  const before = w.gladys.fake.states.length;
  await w.gladys.connect();
  assert.ok(w.gladys.fake.states.length >= before + 30, 'everything published again');
});

test('a gateway 401 shows the refused key and pauses like an errno refusal', async (t) => {
  const w = await createWorld({ connect: false });
  t.after(() => w.app.stop());
  w.cloud.gatewayStatus = 401;
  await w.gladys.connect();
  await w.app.ready;
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: false, message: TEXT.keyRefused });
  w.cloud.gatewayStatus = null;
  const calls = w.cloud.requests.length;
  w.clock.advance(30 * MINUTE);
  await w.hub.refresh();
  assert.equal(w.cloud.requests.length, calls, 'no retry before the pause ends');
  w.clock.advance(31 * MINUTE);
  await w.hub.refresh();
  assert.deepEqual(w.gladys.fake.connectionStatus, { connected: true });
});
