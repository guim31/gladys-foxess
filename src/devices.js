// -----------------------------------------------------------------------------
// One Gladys device per FoxESS inverter, keyed on its serial number
// (`gladys.externalIds('inverter', <deviceSN>)`): what it carries, and the
// states it publishes from a reading. Pure functions, no I/O.
//
// Feature keys are forever (Gladys keys the history, scenes and dashboards on
// them): add new ones, never rename one.
//
// The devices are published with `should_poll: false`: the core does not poll
// external devices reliably (Gladys#3198) and the FoxESS quota wants a slower
// pace than any poll frequency it offers. The hub reads the cloud on its own
// timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { DEVICE_STATUS, ratedPowerKw } from './foxess/model.js';
import { MESSAGES, NAMES, RUNNING_STATE_TEXT, TEXT, pick } from './texts.js';

export const DEVICE_TYPE = 'inverter';

/** Feature keys (the last part of the feature external ids). */
export const FEATURE = {
  PV_POWER: 'pv_power',
  GENERATION_TODAY: 'generation_today',
  GENERATION_TOTAL: 'generation_total',
  LOAD_POWER: 'load_power',
  GRID_IMPORT_POWER: 'grid_import_power',
  GRID_EXPORT_POWER: 'grid_export_power',
  GRID_IMPORT_INDEX: 'grid_import_index',
  GRID_EXPORT_INDEX: 'grid_export_index',
  BATTERY_LEVEL: 'battery_level',
  BATTERY_CHARGE_POWER: 'battery_charge_power',
  BATTERY_DISCHARGE_POWER: 'battery_discharge_power',
  BATTERY_CHARGE_INDEX: 'battery_charge_index',
  BATTERY_DISCHARGE_INDEX: 'battery_discharge_index',
  BATTERY_TEMPERATURE: 'battery_temperature',
  INVERTER_TEMPERATURE: 'inverter_temperature',
  STATUS: 'status',
  ALARM: 'alarm',
  ONLINE: 'online',
};

/** Key of the power feature of PV string `n` (1 to 18). */
export const pvStringKey = (n) => `pv${n}_power`;

const INDEX_MAX = 1_000_000_000; // kWh: a meter index, never reached

/** The ids of an inverter device and of its features. */
export const inverterIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPE, serial);

/** Serial number of a device of this integration, null for another one. */
export function serialOfDevice(gladys, externalId) {
  const prefix = inverterIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const serial = externalId.slice(prefix.length);
  return serial && !serial.includes(':') ? serial : null;
}

/** An inverter has a battery when the cloud says so or reports a charge level. */
export const hasBattery = (inverter, reading) =>
  inverter.hasBattery === true || reading?.hasBatteryData === true;

/** The PV strings to publish: the ones the inverter reports, up to `pvStrings` when set. */
export function pvStrings(reading, config) {
  const numbers = (reading?.strings ?? []).map((s) => s.number);
  return config.pvStrings > 0 ? numbers.filter((n) => n <= config.pvStrings) : numbers;
}

/**
 * The Gladys device of an inverter.
 * @param {object} gladys GladysIntegration
 * @param {object} inverter parseDevice() of the device list
 * @param {object|null} reading parseRealTime(), to know the PV strings and the battery
 * @param {object} config normalized config
 * @param {string} name device name (unique among the published devices)
 */
export function buildInverterDevice(gladys, inverter, reading, config, name) {
  const ids = inverterIds(gladys, inverter.serial);
  const names = NAMES[config.language];
  // The gauges place their needle between min and max: the rated power of the
  // model, with margin (a grid import can exceed it), 10 kW when unknown.
  const ratedW = (ratedPowerKw(inverter.model) ?? 10) * 1000;
  const powerMax = Math.ceil((ratedW * 1.5) / 1000) * 1000;

  const feature = (key, category, type, extra) => ({
    name: names[key],
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...extra,
  });
  const power = (key, category, type, max = powerMax) =>
    feature(key, category, type, { unit: UNIT.WATT, min: 0, max });
  const index = (key, category, type) =>
    feature(key, category, type, { unit: UNIT.KILOWATT_HOUR, min: 0, max: INDEX_MAX });

  const features = [
    power(FEATURE.PV_POWER, CAT.ENERGY_PRODUCTION_SENSOR, TYPE.ENERGY_PRODUCTION_SENSOR.POWER),
    ...pvStrings(reading, config).map((n) => ({
      ...power(pvStringKey(n), CAT.ENERGY_PRODUCTION_SENSOR, TYPE.ENERGY_PRODUCTION_SENSOR.POWER),
      name: names.pv_string_power.replace('{n}', String(n)),
      external_id: ids.feature(pvStringKey(n)),
    })),
    feature(
      FEATURE.GENERATION_TODAY,
      CAT.ENERGY_PRODUCTION_SENSOR,
      TYPE.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
      { unit: UNIT.KILOWATT_HOUR, min: 0, max: Math.ceil(ratedW / 1000) * 24 },
    ),
    // The lifetime production, the index Gladys' energy tracking reads.
    index(
      FEATURE.GENERATION_TOTAL,
      CAT.ENERGY_PRODUCTION_SENSOR,
      TYPE.ENERGY_PRODUCTION_SENSOR.INDEX,
    ),
    // House consumption measured by the inverter: energy-sensor, not
    // home-output-sensor (constants.js of the core: the load can exceed the
    // inverter's own output when the grid tops up).
    power(FEATURE.LOAD_POWER, CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.POWER),
    power(FEATURE.GRID_IMPORT_POWER, CAT.GRID_SENSOR, TYPE.GRID_SENSOR.INPUT_POWER),
    power(FEATURE.GRID_EXPORT_POWER, CAT.GRID_SENSOR, TYPE.GRID_SENSOR.OUTPUT_POWER),
    index(FEATURE.GRID_IMPORT_INDEX, CAT.GRID_SENSOR, TYPE.GRID_SENSOR.INPUT_INDEX),
    index(FEATURE.GRID_EXPORT_INDEX, CAT.GRID_SENSOR, TYPE.GRID_SENSOR.OUTPUT_INDEX),
  ];

  if (hasBattery(inverter, reading)) {
    features.push(
      feature(FEATURE.BATTERY_LEVEL, CAT.BATTERY_STORAGE, TYPE.BATTERY_STORAGE.BATTERY_LEVEL, {
        unit: UNIT.PERCENT,
        min: 0,
        max: 100,
      }),
      power(
        FEATURE.BATTERY_CHARGE_POWER,
        CAT.BATTERY_STORAGE,
        TYPE.BATTERY_STORAGE.CHARGE_POWER,
        ratedW,
      ),
      power(
        FEATURE.BATTERY_DISCHARGE_POWER,
        CAT.BATTERY_STORAGE,
        TYPE.BATTERY_STORAGE.DISCHARGE_POWER,
        ratedW,
      ),
      index(FEATURE.BATTERY_CHARGE_INDEX, CAT.BATTERY_STORAGE, TYPE.BATTERY_STORAGE.CHARGE_INDEX),
      index(
        FEATURE.BATTERY_DISCHARGE_INDEX,
        CAT.BATTERY_STORAGE,
        TYPE.BATTERY_STORAGE.DISCHARGE_INDEX,
      ),
      feature(FEATURE.BATTERY_TEMPERATURE, CAT.DEVICE_TEMPERATURE_SENSOR, TYPE.SENSOR.DECIMAL, {
        unit: UNIT.CELSIUS,
        min: -40,
        max: 100,
      }),
    );
  }

  features.push(
    feature(FEATURE.INVERTER_TEMPERATURE, CAT.DEVICE_TEMPERATURE_SENSOR, TYPE.SENSOR.DECIMAL, {
      unit: UNIT.CELSIUS,
      min: -40,
      max: 120,
    }),
    // Texts: min/max are NOT NULL in Gladys (422 on "Add to Gladys" without).
    feature(FEATURE.STATUS, CAT.TEXT, TYPE.TEXT.TEXT, { min: 0, max: 0, keep_history: true }),
    feature(FEATURE.ALARM, CAT.TEXT, TYPE.TEXT.TEXT, { min: 0, max: 0, keep_history: true }),
    // input/binary: light-sensor/binary has no label in the front.
    feature(FEATURE.ONLINE, CAT.INPUT, TYPE.SENSOR.BINARY, { min: 0, max: 1 }),
  );

  return {
    name,
    external_id: ids.device,
    model: inverter.model,
    should_poll: false,
    features,
  };
}

/** Device names: "FoxESS <model>", the end of the serial added when two would clash. */
export function deviceNames(inverters) {
  const counts = new Map();
  for (const inverter of inverters) {
    counts.set(inverter.model, (counts.get(inverter.model) ?? 0) + 1);
  }
  return new Map(
    inverters.map((inverter) => [
      inverter.serial,
      counts.get(inverter.model) > 1
        ? `FoxESS ${inverter.model} ${inverter.serial.slice(-4)}`
        : `FoxESS ${inverter.model}`,
    ]),
  );
}

/** The status text of an inverter, in `language`. */
export function statusText(inverter, reading, language) {
  if (inverter.status === DEVICE_STATUS.OFFLINE) {
    return pick(TEXT.offline, language);
  }
  if (reading?.runningState) {
    return pick(RUNNING_STATE_TEXT[reading.runningState], language);
  }
  if (inverter.status === DEVICE_STATUS.ALARM) {
    return pick(TEXT.alarmStatus, language);
  }
  return inverter.status === DEVICE_STATUS.ONLINE ? pick(TEXT.online, language) : null;
}

/** The alarm text: the fault the inverter reports, "None" when there is none. */
export function alarmText(inverter, reading, language) {
  if (reading?.fault) {
    return reading.fault.slice(0, 200);
  }
  if (reading?.faultCount > 0) {
    return pick(MESSAGES.faults(reading.faultCount), language);
  }
  if (inverter.status === DEVICE_STATUS.ALARM) {
    return pick(TEXT.alarmStatus, language);
  }
  return reading ? pick(TEXT.noAlarm, language) : null;
}

/**
 * The states of an inverter, in the publishChangedStates format. An offline
 * inverter publishes its status only: the cloud then serves the last values
 * it received, which would look live.
 * @param {object} gladys
 * @param {{ inverter: object, reading: object|null, generation: object|null }} snapshot
 * @param {object} config
 */
export function inverterStates(gladys, { inverter, reading, generation }, config) {
  const ids = inverterIds(gladys, inverter.serial);
  const states = [];
  const number = (key, value) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const text = (key, value) => {
    // A text state is never empty: Gladys ignores it.
    if (typeof value === 'string' && value !== '') {
      states.push({ device_feature_external_id: ids.feature(key), text: value });
    }
  };

  if (inverter.status !== null) {
    number(FEATURE.ONLINE, inverter.status === DEVICE_STATUS.OFFLINE ? 0 : 1);
  }
  text(FEATURE.STATUS, statusText(inverter, reading, config.language));
  if (inverter.status === DEVICE_STATUS.OFFLINE) {
    return states;
  }
  text(FEATURE.ALARM, alarmText(inverter, reading, config.language));

  if (reading) {
    number(FEATURE.PV_POWER, reading.pvPower);
    const published = new Set(pvStrings(reading, config));
    for (const string of reading.strings) {
      if (published.has(string.number)) {
        number(pvStringKey(string.number), string.power);
      }
    }
    number(FEATURE.LOAD_POWER, reading.loadPower);
    number(FEATURE.GRID_IMPORT_POWER, reading.gridImportPower);
    number(FEATURE.GRID_EXPORT_POWER, reading.gridExportPower);
    number(FEATURE.GRID_IMPORT_INDEX, reading.gridImportIndex);
    number(FEATURE.GRID_EXPORT_INDEX, reading.gridExportIndex);
    number(FEATURE.INVERTER_TEMPERATURE, reading.inverterTemperature);
    if (hasBattery(inverter, reading)) {
      number(FEATURE.BATTERY_LEVEL, reading.batteryLevel);
      number(FEATURE.BATTERY_CHARGE_POWER, reading.batteryChargePower);
      number(FEATURE.BATTERY_DISCHARGE_POWER, reading.batteryDischargePower);
      number(FEATURE.BATTERY_CHARGE_INDEX, reading.batteryChargeIndex);
      number(FEATURE.BATTERY_DISCHARGE_INDEX, reading.batteryDischargeIndex);
      number(FEATURE.BATTERY_TEMPERATURE, reading.batteryTemperature);
    }
  }
  // The generation endpoint first, the real-time variables when it fails.
  number(FEATURE.GENERATION_TODAY, generation?.today ?? reading?.todayYield ?? null);
  number(FEATURE.GENERATION_TOTAL, generation?.total ?? reading?.generationIndex ?? null);
  return states;
}
