// -----------------------------------------------------------------------------
// Dashboard widget `overview` (Gladys 5.1+): solar production, house
// consumption, grid exchange and battery of one inverter, at a glance.
//
// The tiles are bound to the device features: they follow the published
// states live, with no refresh. The status rows (inverter state, battery,
// minimum charge, work mode, time of the reading) come from the hub's last
// reading. With inverter control enabled in the configuration, three
// buttons set the work mode, each one confirmed first; the current mode
// carries the check-circle icon (the `primary` style does not show in dark
// mode, Gladys#3153).
//
// Budget of the core: 8 components, 6 tiles, 1 status, 4 buttons, 2 texts.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE, alarmText, hasBattery, inverterIds, statusText } from './devices.js';
import { DEVICE_STATUS, WORK_MODES } from './foxess/model.js';
import { WIDGET_KEY } from './hub.js';
import { MESSAGES, TEXT, pick } from './texts.js';

const MODE_ACTION_PREFIX = 'mode_';
const MODE_ICONS = { SelfUse: 'home', Feedin: 'upload', Backup: 'shield' };

/** Action key of a work mode button: mode_selfuse, mode_feedin, mode_backup. */
export const modeActionKey = (mode) => `${MODE_ACTION_PREFIX}${mode.toLowerCase()}`;

const modeOfAction = (actionKey) =>
  WORK_MODES.find((mode) => modeActionKey(mode) === actionKey) ?? null;

const formatWatts = (watts) =>
  watts >= 1000 ? `${(watts / 1000).toFixed(1)} kW` : `${Math.round(watts)} W`;

/** The device the widget shows: its setting, else the first added inverter. */
function targetDevice(hub, settings) {
  if (settings?.inverter) {
    return settings.inverter;
  }
  const first = hub.createdSerials()[0];
  return first ? inverterIds(hub.gladys, first).device : null;
}

/**
 * The widget content of one inverter snapshot.
 * @param {object} gladys
 * @param {object|null} snapshot hub snapshot `{ inverter, reading, generation, minSoc, ... }`
 * @param {{ language: string, allowControl: boolean, configured: boolean }} context
 */
export function buildOverviewContent(gladys, snapshot, { language, allowControl, configured }) {
  const t = (text) => pick(text, language);
  if (!configured) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.notConfigured) }],
    };
  }
  if (!snapshot) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.pickInverter) }],
    };
  }
  const { inverter, reading } = snapshot;
  const ids = inverterIds(gladys, inverter.serial);
  const battery = hasBattery(inverter, reading);
  const tile = (key, label) => ({
    type: 'value',
    label: t(label),
    device_feature: ids.feature(key),
  });
  const buttons = allowControl && battery ? WORK_MODES : [];

  // By priority. The core keeps 8 components: with the three mode buttons
  // and the status list, four tiles fit; the others become status rows.
  const generationToday = snapshot.generation?.today ?? reading?.todayYield ?? null;
  const tiles = [
    { key: FEATURE.PV_POWER, label: TEXT.solar, value: reading?.pvPower, format: formatWatts },
    { key: FEATURE.LOAD_POWER, label: TEXT.house, value: reading?.loadPower, format: formatWatts },
    ...(battery
      ? [
          {
            key: FEATURE.BATTERY_LEVEL,
            label: TEXT.battery,
            value: reading?.batteryLevel,
            format: (v) => `${v} %`,
          },
        ]
      : []),
    {
      key: FEATURE.GRID_IMPORT_POWER,
      label: TEXT.gridImport,
      value: reading?.gridImportPower,
      format: formatWatts,
    },
    {
      key: FEATURE.GRID_EXPORT_POWER,
      label: TEXT.gridExport,
      value: reading?.gridExportPower,
      format: formatWatts,
    },
    {
      key: FEATURE.GENERATION_TODAY,
      label: TEXT.today,
      value: generationToday,
      format: (v) => `${v} kWh`,
    },
  ];
  const tileCount = Math.min(6, 8 - 1 - buttons.length - (reading ? 0 : 1));
  const components = tiles.slice(0, tileCount).map(({ key, label }) => tile(key, label));
  const foldedRows = tiles
    .slice(tileCount)
    .filter(({ value }) => value !== null && value !== undefined)
    .map(({ label, value, format }) => ({ label: t(label), value: format(value) }));

  if (!reading) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.noReading) });
  }

  const items = [];
  const status = statusText(inverter, reading, language);
  if (status) {
    const color =
      inverter.status === DEVICE_STATUS.OFFLINE
        ? WIDGET_COLORS.NEUTRAL
        : inverter.status === DEVICE_STATUS.ALARM || reading?.fault || reading?.faultCount > 0
          ? WIDGET_COLORS.DANGER
          : WIDGET_COLORS.SUCCESS;
    items.push({ label: t(TEXT.inverter), value: status.slice(0, 40), icon: 'cpu', color });
  }
  if (reading?.fault || reading?.faultCount > 0) {
    items.push({
      label: t(TEXT.alarmStatus),
      value: alarmText(inverter, reading, language).slice(0, 40),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (battery && reading) {
    const charge = reading.batteryChargePower ?? 0;
    const discharge = reading.batteryDischargePower ?? 0;
    const value =
      charge > 0
        ? t(MESSAGES.charging(formatWatts(charge)))
        : discharge > 0
          ? t(MESSAGES.discharging(formatWatts(discharge)))
          : t(TEXT.idle);
    items.push({
      label: t(TEXT.battery),
      value,
      icon: 'battery-charging',
      color:
        charge > 0
          ? WIDGET_COLORS.SUCCESS
          : discharge > 0
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (battery && snapshot.minSoc !== null && snapshot.minSocOnGrid !== null) {
    items.push({
      label: t(TEXT.minSoc),
      value: t(MESSAGES.minSoc(snapshot.minSoc, snapshot.minSocOnGrid)),
      icon: 'battery',
    });
  }
  if (battery && snapshot.workMode) {
    items.push({ label: t(TEXT.workMode), value: t(TEXT[snapshot.workMode]), icon: 'sliders' });
  }
  items.push(...foldedRows);
  if (reading?.clock) {
    items.push({ label: t(TEXT.updated), value: reading.clock, icon: 'clock' });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  for (const mode of buttons) {
    components.push({
      type: 'button',
      label: t(TEXT[mode]),
      icon: snapshot.workMode === mode ? 'check-circle' : MODE_ICONS[mode],
      style: 'secondary',
      action: { key: modeActionKey(mode), confirm: true },
    });
  }

  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, { settings, language }) {
      const config = hub.config ?? { allowControl: false, apiKey: '' };
      const device = targetDevice(hub, settings);
      return buildOverviewContent(hub.gladys, device ? hub.snapshotOf(device) : null, {
        language,
        allowControl: config.allowControl,
        configured: Boolean(hub.client),
      });
    },

    async action(hub, { actionKey, settings }) {
      const mode = modeOfAction(actionKey);
      if (!mode) {
        throw new Error(`Unknown widget action ${actionKey}`);
      }
      return hub.setWorkMode(targetDevice(hub, settings), mode);
    },
  },
};
