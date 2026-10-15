#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real FoxESS Cloud, read-only, with the very client of the
// integration (src/foxess/client.js). Nothing sensitive is printed: no key,
// no signature, serial numbers cut to their last 4 characters.
//
//   node scripts/probe.mjs
//     Signs a request with a FAKE key. The expected answer is a refused key
//     (errno 41808 or 41809): the signature and the timestamp were accepted,
//     only the key was not. errno 40256 means the signature itself is wrong.
//
//   FOXESS_API_KEY=<key> node scripts/probe.mjs
//     With a real key: lists the inverters, reads their real-time values,
//     production, minimum charge and work mode once, and prints which of the
//     variables the integration uses are present. About 2 + 4 per inverter
//     calls of the daily quota. Writes nothing.
// -----------------------------------------------------------------------------

import { FoxessApiError, FoxessClient } from '../src/foxess/client.js';
import {
  parseDevice,
  parseGeneration,
  parseMinSoc,
  parseRealTime,
  parseWorkMode,
} from '../src/foxess/model.js';

const short = (serial) => `…${String(serial).slice(-4)}`;

// The variables src/foxess/model.js reads.
const USED_VARIABLES = [
  'pvPower',
  'pv1Power',
  'loadsPower',
  'gridConsumptionPower',
  'feedinPower',
  'gridConsumption',
  'feedin',
  'generation',
  'todayYield',
  'SoC',
  'SoC_1',
  'batChargePower',
  'batDischargePower',
  'batTemperature',
  'batTemperature_1',
  'chargeEnergyToTal',
  'dischargeEnergyToTal',
  'invTemperation',
  'runningState',
  'currentFault',
  'currentFaultCount',
];

function report(label, err) {
  if (err instanceof FoxessApiError) {
    console.log(`${label}: errno ${err.errno} (${err.kind})`);
  } else {
    console.log(`${label}: ${err.kind ?? 'error'} — ${err.message}`);
  }
}

async function probeFakeKey() {
  const client = new FoxessClient({ apiKey: 'gladys-foxess-probe-not-a-real-key-000000' });
  try {
    await client.listDevices();
    console.log('UNEXPECTED: a fake key was accepted');
    process.exitCode = 1;
  } catch (err) {
    report('device/list with a fake key', err);
    if (err.kind === 'auth') {
      console.log('OK: signature and timestamp accepted, the fake key refused as expected.');
    } else if (err.kind === 'signature') {
      console.log('PROBLEM: the cloud refused the signature or the timestamp (check the clock).');
      process.exitCode = 1;
    } else {
      console.log('PROBLEM: no Open API answer (network, proxy, or the API changed).');
      process.exitCode = 1;
    }
  }
}

async function probeRealKey(apiKey) {
  const client = new FoxessClient({ apiKey });
  let devices;
  try {
    devices = (await client.listDevices()).map(parseDevice).filter(Boolean);
  } catch (err) {
    report('device/list', err);
    process.exitCode = 1;
    return;
  }
  console.log(`device/list: ${devices.length} inverter(s)`);
  for (const d of devices) {
    console.log(`  ${short(d.serial)} ${d.model} battery=${d.hasBattery} status=${d.status}`);
  }
  if (devices.length === 0) {
    return;
  }
  try {
    const entries = await client.realTime(devices.map((d) => d.serial));
    for (const entry of entries) {
      const names = new Set((entry.datas ?? []).map((v) => v.variable));
      const reading = parseRealTime(entry);
      console.log(
        `real/query ${short(entry.deviceSN)}: ${names.size} variables, time "${entry.time}"`,
      );
      console.log(`  used and present: ${USED_VARIABLES.filter((v) => names.has(v)).join(', ')}`);
      console.log(`  used and missing: ${USED_VARIABLES.filter((v) => !names.has(v)).join(', ')}`);
      const units = [...new Set((entry.datas ?? []).map((v) => v.unit))].join(' | ');
      console.log(`  units seen: ${units}`);
      console.log(
        `  parsed: pv=${reading.pvPower} W, load=${reading.loadPower} W, import=${reading.gridImportPower} W, ` +
          `export=${reading.gridExportPower} W, soc=${reading.batteryLevel} %, state=${reading.runningState}, ` +
          `strings=${reading.strings.map((s) => s.number).join(',')}`,
      );
    }
  } catch (err) {
    report('real/query', err);
  }
  for (const d of devices) {
    const step = async (label, fn) => {
      try {
        console.log(`${label} ${short(d.serial)}: ${JSON.stringify(await fn())}`);
      } catch (err) {
        report(`${label} ${short(d.serial)}`, err);
      }
    };
    await step('generation', async () => parseGeneration(await client.generation(d.serial)));
    if (d.hasBattery) {
      await step('battery/soc/get', async () => parseMinSoc(await client.getMinSoc(d.serial)));
      await step('setting/get WorkMode', async () => {
        const raw = await client.getSetting(d.serial, 'WorkMode');
        return { parsed: parseWorkMode(raw), raw: raw?.value };
      });
    }
  }
  try {
    const count = await client.accessCount();
    console.log(`getAccessCount: ${JSON.stringify(count)}`);
  } catch (err) {
    report('getAccessCount', err);
  }
  console.log(`calls sent: ${client.callCount}`);
}

const apiKey = process.env.FOXESS_API_KEY?.trim();
await (apiKey ? probeRealKey(apiKey) : probeFakeKey());
