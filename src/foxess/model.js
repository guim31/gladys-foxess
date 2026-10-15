// -----------------------------------------------------------------------------
// From the Open API answers to plain readings, in the units Gladys stores:
// watts (the API gives kW), kWh, °C, %. Pure functions, no I/O.
//
// Variable names are the ones of `/op/v1/device/real/query` (FoxESS spells
// some of them its own way: `invTemperation`, `chargeEnergyToTal`, `SoC_1`).
// A value the inverter does not report stays `null`: nothing is published
// for it rather than a fake zero.
// -----------------------------------------------------------------------------

import { MAX_PV_STRINGS } from '../config.js';

/** `status` of `/op/v0/device/list`: 1 online, 2 in alarm (fault), 3 offline. */
export const DEVICE_STATUS = { ONLINE: 1, ALARM: 2, OFFLINE: 3 };

/** `runningState` codes of the inverter (FoxESS protocol). */
export const RUNNING_STATES = {
  160: 'selfTest',
  161: 'waiting',
  162: 'checking',
  163: 'onGrid',
  164: 'offGrid',
  165: 'fault',
  166: 'permanentFault',
  167: 'standby',
  168: 'upgrading',
  169: 'fct',
  170: 'illegal',
};

/** Work modes the integration can set (`WorkMode` setting of the Open API). */
export const WORK_MODES = ['SelfUse', 'Feedin', 'Backup'];

const finite = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const round = (value, digits) => {
  if (value === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** A power in W: the API speaks kW, a W unit is taken as is. */
function watts(entry) {
  const value = finite(entry?.value);
  if (value === null) {
    return null;
  }
  const unit = typeof entry.unit === 'string' ? entry.unit.trim().toLowerCase() : 'kw';
  return Math.round(unit === 'w' ? value : value * 1000);
}

/** Never below zero: a meter that drifts gives -0.01 kW at night. */
const positive = (value) => (value === null ? null : Math.max(0, value));

/**
 * One inverter of `/op/v0/device/list`.
 * @returns {{ serial: string, model: string, station: string|null, hasBattery: boolean, hasPv: boolean, status: number|null }|null}
 */
export function parseDevice(raw) {
  if (!raw || typeof raw.deviceSN !== 'string' || raw.deviceSN.trim() === '') {
    return null;
  }
  const status = finite(raw.status);
  return {
    serial: raw.deviceSN.trim(),
    model:
      typeof raw.deviceType === 'string' && raw.deviceType.trim()
        ? raw.deviceType.trim()
        : 'Inverter',
    station:
      typeof raw.stationName === 'string' && raw.stationName.trim() ? raw.stationName.trim() : null,
    hasBattery: raw.hasBattery === true || raw.hasBattery === 1 || raw.hasBattery === '1',
    hasPv: raw.hasPV !== false && raw.hasPV !== 0,
    status: Object.values(DEVICE_STATUS).includes(status) ? status : null,
  };
}

/**
 * The `HH:MM` of the cloud time stamp ("2026-10-14 13:05:21 CEST+0200"), in
 * the time of the installation: what the FoxESS app shows. Parsing the offset
 * is not reliable (some accounts label a local time GMT), so the clock time is
 * kept as written.
 */
export function readingClock(time) {
  const match = typeof time === 'string' ? time.match(/\b(\d{2}):(\d{2}):\d{2}\b/) : null;
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * One entry of `/op/v1/device/real/query`.
 * @param {{ deviceSN: string, time?: string, datas?: object[] }} raw
 */
export function parseRealTime(raw) {
  const vars = new Map();
  for (const entry of Array.isArray(raw?.datas) ? raw.datas : []) {
    if (entry && typeof entry.variable === 'string') {
      vars.set(entry.variable, entry);
    }
  }
  // Batteries reported per pack on some models: the first pack stands for all.
  const pick = (...names) =>
    names.map((name) => vars.get(name)).find((entry) => entry !== undefined);
  const value = (...names) => finite(pick(...names)?.value);
  const power = (...names) => positive(watts(pick(...names)));

  const strings = [];
  for (let n = 1; n <= MAX_PV_STRINGS; n += 1) {
    if (vars.has(`pv${n}Power`)) {
      strings.push({ number: n, power: power(`pv${n}Power`) });
    }
  }
  let pvPower = power('pvPower');
  if (pvPower === null && strings.some((s) => s.power !== null)) {
    pvPower = strings.reduce((sum, s) => sum + (s.power ?? 0), 0);
  }

  const soc = value('SoC', 'SoC_1');
  const runningCode = value('runningState');
  const faultText = pick('currentFault')?.value;
  const faultCount = value('currentFaultCount');

  return {
    serial: typeof raw?.deviceSN === 'string' ? raw.deviceSN : null,
    clock: readingClock(raw?.time),
    pvPower,
    strings,
    loadPower: power('loadsPower'),
    gridImportPower: power('gridConsumptionPower'),
    gridExportPower: power('feedinPower'),
    gridImportIndex: positive(round(value('gridConsumption'), 2)),
    gridExportIndex: positive(round(value('feedin'), 2)),
    generationIndex: positive(round(value('generation'), 2)),
    todayYield: positive(round(value('todayYield'), 2)),
    hasBatteryData: soc !== null,
    batteryLevel: soc === null ? null : Math.min(100, Math.max(0, Math.round(soc))),
    batteryChargePower: power('batChargePower'),
    batteryDischargePower: power('batDischargePower'),
    batteryTemperature: round(value('batTemperature', 'batTemperature_1'), 1),
    batteryChargeIndex: positive(round(value('chargeEnergyToTal'), 2)),
    batteryDischargeIndex: positive(round(value('dischargeEnergyToTal'), 2)),
    inverterTemperature: round(value('invTemperation'), 1),
    runningState:
      runningCode !== null && RUNNING_STATES[runningCode] ? RUNNING_STATES[runningCode] : null,
    faultCount: faultCount === null ? null : Math.max(0, Math.round(faultCount)),
    fault: typeof faultText === 'string' && faultText.trim() !== '' ? faultText.trim() : null,
  };
}

/** `/op/v0/device/generation`: `{ today, month, cumulative }` in kWh. */
export function parseGeneration(raw) {
  return {
    today: positive(round(finite(raw?.today), 2)) ?? (raw && typeof raw === 'object' ? 0 : null),
    total: positive(round(finite(raw?.cumulative), 2)),
  };
}

/** `/op/v0/device/battery/soc/get`: `{ minSoc, minSocOnGrid }`. */
export function parseMinSoc(raw) {
  const minSoc = finite(raw?.minSoc);
  const minSocOnGrid = finite(raw?.minSocOnGrid);
  return {
    minSoc: minSoc === null ? null : Math.round(minSoc),
    minSocOnGrid: minSocOnGrid === null ? null : Math.round(minSocOnGrid),
  };
}

/** `/op/v0/device/setting/get` with key `WorkMode`: one of WORK_MODES, else null. */
export function parseWorkMode(raw) {
  const value = typeof raw?.value === 'string' ? raw.value.trim() : null;
  return WORK_MODES.find((mode) => mode.toLowerCase() === value?.toLowerCase()) ?? null;
}

/**
 * Rated power in kW read from the model name (H1-5.0-E → 5, H3-10.0-E → 10,
 * KH10 → 10), null when it cannot be read. Used for the gauge bounds only.
 */
export function ratedPowerKw(model) {
  const numbers = typeof model === 'string' ? (model.match(/\d+(?:\.\d+)?/g) ?? []) : [];
  // "H1-5.0-E": the decimal one, the 1 is the phase count; "KH10", "T10-G3":
  // the first with two digits; "AIO-H3": no power in the name.
  const found = numbers.find((n) => n.includes('.')) ?? numbers.find((n) => n.length >= 2);
  if (!found) {
    return null;
  }
  const kw = Number(found);
  // F/S series name the power in W (F3000 = 3 kW).
  const value = kw >= 500 ? kw / 1000 : kw;
  return value >= 0.5 && value <= 100 ? value : null;
}
