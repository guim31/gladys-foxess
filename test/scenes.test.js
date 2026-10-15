// -----------------------------------------------------------------------------
// The scene actions: refused while control is off (the default), applied
// through the Open API when it is on, a clear refusal when the FoxESS app
// holds the settings (a schedule is active, errno 44096).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS } from '../src/foxess/client.js';
import { SN_HYBRID, SN_SOLAR, createWorld, deviceId } from './helpers/world.js';

test('control off (the default): the actions are refused and nothing is sent', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const ack = await w.gladys.fake.sceneAction('set_work_mode', {
    device: deviceId(w.gladys, SN_HYBRID),
    mode: 'Backup',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /control is off/);
  assert.match(ack.error, /pilotage/);
  assert.equal(w.cloud.countOf(PATHS.settingSet), 0);
});

test('control on: the work mode and the minimum charge are written', async (t) => {
  const w = await createWorld({ config: { allow_control: true } });
  t.after(() => w.app.stop());
  const device = deviceId(w.gladys, SN_HYBRID);

  let ack = await w.gladys.fake.sceneAction('set_work_mode', { device, mode: 'Backup' });
  assert.deepEqual(ack, { success: true, data: { outputs: { work_mode: 'Backup' } } });
  assert.equal(w.cloud.workMode.get(SN_HYBRID), 'Backup');
  const set = w.cloud.requests.find((r) => r.path === PATHS.settingSet);
  assert.deepEqual(set.body, { sn: SN_HYBRID, key: 'WorkMode', value: 'Backup' });

  ack = await w.gladys.fake.sceneAction('set_min_soc', {
    device,
    min_soc: 15,
    min_soc_on_grid: 30,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { min_soc: 15, min_soc_on_grid: 30 } } });
  assert.deepEqual(w.cloud.minSoc.get(SN_HYBRID), { minSoc: 15, minSocOnGrid: 30 });
});

test('invalid values, an inverter without battery or unknown are refused before any call', async (t) => {
  const w = await createWorld({ config: { allow_control: true } });
  t.after(() => w.app.stop());
  const device = deviceId(w.gladys, SN_HYBRID);
  const calls = w.cloud.requests.length;
  const refused = [
    ['set_min_soc', { device, min_soc: 5, min_soc_on_grid: 20 }],
    ['set_min_soc', { device, min_soc: 30, min_soc_on_grid: 20 }],
    ['set_min_soc', { device, min_soc: 10.5, min_soc_on_grid: 20 }],
    ['set_work_mode', { device, mode: 'ForceDischarge' }],
    ['set_work_mode', { device: deviceId(w.gladys, SN_SOLAR), mode: 'SelfUse' }],
    ['set_work_mode', { device: 'ext:test-integration:inverter:UNKNOWN000', mode: 'SelfUse' }],
  ];
  for (const [key, fields] of refused) {
    const ack = await w.gladys.fake.sceneAction(key, fields);
    assert.equal(ack.success, false, `${key} ${JSON.stringify(fields)}`);
  }
  assert.equal(w.cloud.requests.length, calls);
});

test('a schedule active in the FoxESS app: the refusal says what to do', async (t) => {
  const w = await createWorld({ config: { allow_control: true } });
  t.after(() => w.app.stop());
  w.cloud.scheduleActive = true;
  const ack = await w.gladys.fake.sceneAction('set_work_mode', {
    device: deviceId(w.gladys, SN_HYBRID),
    mode: 'Feedin',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /schedule is active/);
  assert.equal(w.cloud.workMode.get(SN_HYBRID), 'SelfUse');
});

test('the test action lists the inverters and the calls left today', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const ack = await w.gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const message = ack.data.message ?? ack.data;
  assert.match(message.en, /H1-5\.0-E \(60BH50000000001\), T10-G3/);
  assert.match(message.fr, /Appels d'API restants aujourd'hui : 1203 \/ 1440/);

  w.cloud.apiKey = 'another-key';
  const refused = await w.gladys.fake.action('test_connection', {});
  assert.match((refused.data.message ?? refused.data).en, /refused the API key/);
});
