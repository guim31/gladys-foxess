// -----------------------------------------------------------------------------
// A whole integration under test: the SDK's fake Gladys
// (`@gladysassistant/integration-sdk/testing`, a real GladysIntegration whose
// transport is in memory and which refuses what Gladys refuses), the very
// wiring of src/app.js, and an in-memory FoxESS Cloud. No timer runs: the
// tests move the clock and call `hub.refresh()` — what the timer does.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { API_KEY, FakeFoxess, SN_HYBRID, SN_SOLAR } from './fakeFoxess.js';

export { API_KEY, FakeFoxess, SN_HYBRID, SN_SOLAR };

export function createClock(start = Date.parse('2026-10-14T11:05:00Z')) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

/** External id of an inverter device in the fake Gladys. */
export const deviceId = (gladys, serial) => gladys.externalIds('inverter', serial).device;
export const featureId = (gladys, serial, key) =>
  gladys.externalIds('inverter', serial).feature(key);

/**
 * @param {object} [options]
 * @param {object} [options.config] the configuration (api_key filled in by default)
 * @param {string[]} [options.created] serials already added to Gladys
 * @param {object} [options.cloud] FakeFoxess options, or `cloud: <FakeFoxess>`
 * @param {object} [options.clock]
 * @param {boolean} [options.connect] connect at once (default true)
 */
export async function createWorld({
  config = {},
  created = [SN_HYBRID, SN_SOLAR],
  cloud,
  clock = createClock(),
  connect = true,
} = {}) {
  const server = cloud instanceof FakeFoxess ? cloud : new FakeFoxess({ now: clock.now, ...cloud });
  const gladys = createFakeGladys({
    config: { api_key: API_KEY, language: 'en', ...config },
  });
  gladys.fake.devices = created.map((serial) => ({
    external_id: deviceId(gladys, serial),
    name: `FoxESS ${serial}`,
    features: [],
  }));
  const app = registerHandlers(gladys, {
    request: server.handle,
    timers: false,
    now: clock.now,
    minIntervalMs: 0,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, app, hub: app.hub, cloud: server, clock };
}

/** The last published value of a feature: a number, or a text. */
export function lastValue(gladys, serial, key) {
  const id = featureId(gladys, serial, key);
  const states = gladys.fake.states.filter((s) => s.device_feature_external_id === id);
  const last = states.at(-1);
  return last === undefined ? undefined : (last.state ?? last.text);
}
