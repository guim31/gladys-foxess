// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: a hybrid inverter with a battery and four reported PV strings, a
// three-phase inverter without battery, an unknown model reporting a battery
// per pack and 18 strings — in every feature-name language, with and without
// a limit on the PV strings.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeFoxess, createClock, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** A third inverter: unknown model name, battery per pack, 18 strings, in alarm. */
function cloudWithOddInverter(clock) {
  const cloud = new FakeFoxess({ now: clock.now });
  cloud.devices.push({ deviceSN: '60ZZ00000000003', deviceType: 'AIO-H3', status: 2 });
  const datas = [
    { variable: 'SoC_1', value: 41, unit: '%' },
    { variable: 'batTemperature_1', value: 12.5, unit: '℃' },
    { variable: 'currentFault', value: 'Grid Lost Fault' },
    { variable: 'currentFaultCount', value: 1 },
  ];
  for (let n = 1; n <= 18; n += 1) {
    datas.push({ variable: `pv${n}Power`, value: 0.1, unit: 'kW' });
  }
  cloud.readings.set('60ZZ00000000003', { deviceSN: '60ZZ00000000003', datas });
  return cloud;
}

const scenarios = [
  { label: 'English names', config: { language: 'en' } },
  { label: 'French names', config: { language: 'fr' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
  { label: 'two PV strings at most', config: { language: 'fr', pv_strings: 2 } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const clock = createClock();
    const { gladys, app } = await createWorld({
      config: scenario.config,
      clock,
      cloud: cloudWithOddInverter(clock),
    });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 3, 'the three fixture inverters');
      const deviceNames = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceNames.has(device.name), `${where}: duplicate device name`);
        deviceNames.add(device.name);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} is not a unit of ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 40, `${at}: name longer than 40 characters`);
        }
      }

      if (scenario.config.pv_strings === 2) {
        for (const device of devices) {
          assert.ok(
            !device.features.some((f) => /:pv[3-9]_power$|:pv1\d_power$/.test(f.external_id)),
            `${device.name}: strings above 2 published`,
          );
        }
      }
    } finally {
      app.stop();
    }
  });
}
