// -----------------------------------------------------------------------------
// From the Open API answers to readings: kW to W, strings, battery, states,
// the quirks (SoC_1, negative values at night, a missing value).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_STATUS,
  parseDevice,
  parseGeneration,
  parseMinSoc,
  parseRealTime,
  parseWorkMode,
  ratedPowerKw,
  readingClock,
} from '../src/foxess/model.js';
import { fixture } from './helpers/fakeFoxess.js';

const [hybridRaw, solarRaw] = fixture('real-query').result;

test('a hybrid inverter reading, in W, kWh, °C and %', () => {
  const r = parseRealTime(hybridRaw);
  assert.equal(r.serial, '60BH50000000001');
  assert.equal(r.clock, '13:05');
  assert.equal(r.pvPower, 3412);
  assert.deepEqual(r.strings, [
    { number: 1, power: 1905 },
    { number: 2, power: 1507 },
    { number: 3, power: 0 },
    { number: 4, power: 0 },
  ]);
  assert.equal(r.loadPower, 1734);
  assert.equal(r.gridImportPower, 0);
  assert.equal(r.gridExportPower, 512);
  assert.equal(r.gridImportIndex, 2789.1);
  assert.equal(r.gridExportIndex, 3456.71);
  assert.equal(r.generationIndex, 8123.4);
  assert.equal(r.todayYield, 12.6);
  assert.equal(r.hasBatteryData, true);
  assert.equal(r.batteryLevel, 64);
  assert.equal(r.batteryChargePower, 735);
  assert.equal(r.batteryDischargePower, 0);
  assert.equal(r.batteryTemperature, 21.5);
  assert.equal(r.batteryChargeIndex, 1678.2);
  assert.equal(r.batteryDischargeIndex, 1540.9);
  assert.equal(r.inverterTemperature, 38.2);
  assert.equal(r.runningState, 'onGrid');
  assert.equal(r.fault, null);
  assert.equal(r.faultCount, 0);
});

test('an inverter without battery has no battery values', () => {
  const r = parseRealTime(solarRaw);
  assert.equal(r.hasBatteryData, false);
  assert.equal(r.batteryLevel, null);
  assert.equal(r.batteryChargePower, null);
  assert.equal(r.pvPower, 6204);
  assert.equal(r.strings.length, 2);
});

test('quirks: a W unit, a negative value at night, a pack-numbered battery, a missing total', () => {
  const r = parseRealTime({
    deviceSN: 'X',
    datas: [
      { variable: 'feedinPower', value: -0.01, unit: 'kW' },
      { variable: 'loadsPower', value: 412, unit: 'W' },
      { variable: 'pv1Power', value: 0.5 },
      { variable: 'pv2Power', value: 0.25 },
      { variable: 'SoC_1', value: 99.6 },
      { variable: 'batTemperature_1', value: 18.25 },
      { variable: 'gridConsumptionPower', value: null },
      { variable: 'currentFault', value: '  Grid Lost Fault ' },
      { variable: 'currentFaultCount', value: 1 },
      { variable: 'runningState', value: '999' },
    ],
  });
  assert.equal(r.gridExportPower, 0);
  assert.equal(r.loadPower, 412);
  assert.equal(r.pvPower, 750, 'the sum of the strings when pvPower is missing');
  assert.equal(r.batteryLevel, 100);
  assert.equal(r.batteryTemperature, 18.3);
  assert.equal(r.gridImportPower, null, 'a null value stays null, not 0');
  assert.equal(r.fault, 'Grid Lost Fault');
  assert.equal(r.faultCount, 1);
  assert.equal(r.runningState, null, 'an unknown code is not a state');
  assert.equal(r.clock, null);
});

test('the device list entries', () => {
  const [hybrid, solar] = fixture('device-list').result.data.map(parseDevice);
  assert.deepEqual(hybrid, {
    serial: '60BH50000000001',
    model: 'H1-5.0-E',
    station: 'Home',
    hasBattery: true,
    hasPv: true,
    status: DEVICE_STATUS.ONLINE,
  });
  assert.equal(solar.hasBattery, false);
  assert.equal(parseDevice({ deviceSN: '' }), null);
  assert.equal(parseDevice({ deviceSN: 'ABC123456', status: 7 }).status, null);
  assert.equal(parseDevice({ deviceSN: 'ABC123456' }).model, 'Inverter');
});

test('generation, minimum charge and work mode', () => {
  assert.deepEqual(parseGeneration(fixture('generation').result), { today: 12.7, total: 8123.5 });
  // No `today` key before the first kWh of the day.
  assert.deepEqual(parseGeneration({ month: 3, cumulative: 10 }), { today: 0, total: 10 });
  assert.deepEqual(parseGeneration(null), { today: null, total: null });
  assert.deepEqual(parseMinSoc(fixture('soc-get').result), { minSoc: 10, minSocOnGrid: 20 });
  assert.equal(parseWorkMode(fixture('setting-workmode').result), 'SelfUse');
  assert.equal(parseWorkMode({ value: 'feedin' }), 'Feedin');
  assert.equal(parseWorkMode({ value: 'PeakShaving' }), null);
});

test('the rated power read from the model name', () => {
  assert.equal(ratedPowerKw('H1-5.0-E'), 5);
  assert.equal(ratedPowerKw('H3-10.0-E'), 10);
  assert.equal(ratedPowerKw('KH10'), 10);
  assert.equal(ratedPowerKw('F3000'), 3);
  assert.equal(ratedPowerKw('AIO-H3'), null);
  assert.equal(ratedPowerKw(undefined), null);
});

test('the clock of a reading is kept as the cloud writes it', () => {
  assert.equal(readingClock('2026-04-07 10:44:04 AEST+1000'), '10:44');
  assert.equal(readingClock('2025-02-21 16:38:29 GMT+0000'), '16:38');
  assert.equal(readingClock(42), null);
});
