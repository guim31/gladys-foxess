// -----------------------------------------------------------------------------
// The `overview` widget: a content the core renders exactly as sent
// (validateWidgetContent of the SDK), tiles bound to features the device
// really has, the work mode buttons only when control is allowed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../src/config.js';
import { modeActionKey } from '../src/widgets.js';
import { SN_HYBRID, SN_SOLAR, createWorld, deviceId } from './helpers/world.js';

async function content(w, settings, language = 'en') {
  const ack = await w.gladys.fake.widgetGet('overview', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, JSON.stringify(ack));
  return ack.data.content ?? ack.data;
}

function boundFeatures(c) {
  return c.components.filter((x) => x.device_feature).map((x) => x.device_feature);
}

test('the widget content fits the core vocabulary and budget, in every language', async (t) => {
  for (const allow of [false, true]) {
    const w = await createWorld({ config: { allow_control: allow } });
    t.after(() => w.app.stop());
    for (const serial of [SN_HYBRID, SN_SOLAR]) {
      for (const language of LANGUAGES) {
        const c = await content(w, { inverter: deviceId(w.gladys, serial) }, language);
        assert.deepEqual(validateWidgetContent(c), [], `${serial} ${language}`);
      }
    }
  }
});

test('the tiles are bound to features the published device has', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  for (const serial of [SN_HYBRID, SN_SOLAR]) {
    const device = w.gladys.fake.discoveredDevices.find(
      (d) => d.external_id === deviceId(w.gladys, serial),
    );
    const ids = new Set(device.features.map((f) => f.external_id));
    const c = await content(w, { inverter: device.external_id });
    const bound = boundFeatures(c);
    assert.ok(bound.length >= 5);
    for (const id of bound) {
      assert.ok(ids.has(id), `${id} is not a feature of ${device.name}`);
    }
  }
});

test('the status rows: state, battery, minimum charge, work mode, time of the reading', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const c = await content(w, { inverter: deviceId(w.gladys, SN_HYBRID) }, 'fr');
  const status = c.components.find((x) => x.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Onduleur', 'Raccordé au réseau'],
      ['Batterie', 'En charge, 735 W'],
      ['Charge minimale', '10 %, sur réseau 20 %'],
      ['Mode de travail', 'Autoconsommation'],
      ['Mis à jour', '13:05'],
    ],
  );
  assert.ok(!c.components.some((x) => x.type === 'button'), 'no button without control');
});

test('with control allowed, three confirmed mode buttons; the current one carries the check', async (t) => {
  const w = await createWorld({ config: { allow_control: true } });
  t.after(() => w.app.stop());
  const settings = { inverter: deviceId(w.gladys, SN_HYBRID) };
  let buttons = (await content(w, settings)).components.filter((x) => x.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.action.key, b.icon, b.action.confirm]),
    [
      [modeActionKey('SelfUse'), 'check-circle', true],
      [modeActionKey('Feedin'), 'upload', true],
      [modeActionKey('Backup'), 'shield', true],
    ],
  );
  assert.ok(
    buttons.every((b) => b.style !== 'primary'),
    'primary does not show in dark mode',
  );

  const ack = await w.gladys.fake.widgetAction(
    'overview',
    modeActionKey('Feedin'),
    {},
    { settings },
  );
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.equal(w.cloud.workMode.get(SN_HYBRID), 'Feedin');
  buttons = (await content(w, settings)).components.filter((x) => x.type === 'button');
  assert.equal(buttons[1].icon, 'check-circle');

  // No battery, no button.
  const solar = await content(w, { inverter: deviceId(w.gladys, SN_SOLAR) });
  assert.ok(!solar.components.some((x) => x.type === 'button'));
});

test('without setting the widget shows the first added inverter; unknown or unconfigured say so', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  assert.ok(boundFeatures(await content(w, {}))[0].includes(SN_HYBRID));
  const unknown = await content(w, { inverter: 'ext:test-integration:inverter:NOPE00000000' });
  assert.equal(unknown.components[0].type, 'text');

  const empty = await createWorld({ config: { api_key: '' } });
  t.after(() => empty.app.stop());
  const c = await content(empty, {}, 'de');
  assert.match(c.components[0].text, /API-Schlüssel/);
  assert.deepEqual(validateWidgetContent(c), []);
});

test('an inverter in alarm shows the fault in red', async (t) => {
  const w = await createWorld({ connect: false });
  t.after(() => w.app.stop());
  w.cloud.setVariable(SN_SOLAR, 'currentFault', 'Grid Lost Fault');
  w.cloud.setVariable(SN_SOLAR, 'currentFaultCount', 1);
  w.cloud.setStatus(SN_SOLAR, 2);
  await w.gladys.connect();
  await w.app.ready;
  const c = await content(w, { inverter: deviceId(w.gladys, SN_SOLAR) });
  const items = c.components.find((x) => x.type === 'status').items;
  assert.ok(items.some((item) => item.value === 'Grid Lost Fault' && item.color === 'danger'));
  assert.deepEqual(validateWidgetContent(c), []);
});

test('with the mode buttons, the tiles that do not fit become status rows', async (t) => {
  const w = await createWorld({ config: { allow_control: true, language: 'en' } });
  t.after(() => w.app.stop());
  const c = await content(w, { inverter: deviceId(w.gladys, SN_HYBRID) });
  assert.equal(c.components.filter((x) => x.type === 'value').length, 4);
  const rows = c.components.find((x) => x.type === 'status').items.map((i) => [i.label, i.value]);
  assert.ok(rows.some(([label, value]) => label === 'To grid' && value === '512 W'));
  assert.ok(rows.some(([label, value]) => label === 'Today' && value === '12.7 kWh'));
  assert.deepEqual(validateWidgetContent(c), []);
});
