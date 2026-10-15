// -----------------------------------------------------------------------------
// The FoxESS hub: reads the cloud on its own timer, keeps the last readings,
// publishes the devices and their states, runs the commands.
//
// Quota. The Open API allows 1,440 calls a day (one a minute on average), and
// refuses bursts. One reading cycle, every `refresh_minutes` (5 by default):
//   - the real-time values of every added inverter, in ONE call;
//   - every 15 minutes at most: the device list (online / alarm / offline
//     status of every inverter, one call) and the production of the day and
//     lifetime (one call per inverter);
//   - every hour, for an inverter with a battery: its minimum charge and its
//     work mode (two calls).
// That is 528 calls a day for one inverter at 5 minutes (see docs/).
// A refused call for quota or burst (errno 40400-40402) pauses the readings
// for 30 minutes; a refused key, for an hour or until the configuration
// changes.
//
// The core does not poll external devices reliably (Gladys#3198): the timer
// does the work, onPoll is a fallback that skips when the timer just ran.
// Only the inverters the user added to Gladys are read on every cycle; the
// others once, to describe them in the Discovery tab.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import {
  alarmText,
  buildInverterDevice,
  deviceNames,
  hasBattery,
  inverterIds,
  inverterStates,
  serialOfDevice,
} from './devices.js';
import { FoxessClient } from './foxess/client.js';
import {
  WORK_MODES,
  parseDevice,
  parseGeneration,
  parseMinSoc,
  parseRealTime,
  parseWorkMode,
} from './foxess/model.js';
import { createIssueLog } from './issues.js';
import { MESSAGES, TEXT, thrown } from './texts.js';

const logger = createLogger({ name: 'foxess' });

export const WIDGET_KEY = 'overview';
export const FAULT_TRIGGER = 'inverter_fault';

export const TIMINGS = {
  /** Device list and daily production: not more often than this. */
  slowMs: 15 * 60_000,
  /** Minimum charge and work mode. */
  settingsMs: 60 * 60_000,
  /** Pause after a quota or burst refusal. */
  ratePauseMs: 30 * 60_000,
  /** Pause after a refused key. */
  authPauseMs: 60 * 60_000,
  /** An unchanged value is published again after this long. */
  heartbeatMs: 6 * 60 * 60_000,
};

/** Real-time values asked per call. */
const REAL_TIME_BATCH = 20;

/** The end of a serial number, enough to tell two inverters apart in the logs. */
export const shortSerial = (serial) => `…${serial.slice(-4)}`;

export class FoxessHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam of the client
   * @param {boolean} [options.timers] run the periodic timer (tests turn it off)
   * @param {() => number} [options.now]
   * @param {number} [options.minIntervalMs] gap between two API calls
   * @param {object} [options.timings] overrides of TIMINGS
   */
  constructor({ gladys, request, timers = true, now = () => Date.now(), minIntervalMs, timings }) {
    this.gladys = gladys;
    this.request = request;
    this.timers = timers;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.timings = { ...TIMINGS, ...timings };
    this.issues = createIssueLog(logger);
    this.config = null;
    this.client = null;
    this.timer = null;
    this.stopped = true;
    this.running = null;
    this.reset();
  }

  /** Forget everything read: a new key may be another account. */
  reset() {
    /** By serial: `{ inverter, reading, generation, minSoc, minSocOnGrid, workMode }`. */
    this.snapshots = new Map();
    this.listReadAt = null;
    this.generationReadAt = new Map();
    this.settingsReadAt = new Map();
    this.workModeUnsupported = new Set();
    /** Last fault seen by serial; absent until the first reading (no event at start-up). */
    this.lastFault = new Map();
    this.pausedUntil = 0;
    this.lastCycleAt = null;
    this.publishedSignature = null;
    this.statusKey = null;
    this.missingSerials = [];
  }

  get refreshMs() {
    return this.config.refreshMs;
  }

  // --- Lifecycle ----------------------------------------------------------------

  /** First start, or a new configuration: everything is read again now. */
  async start(config) {
    this.stopTimer();
    this.config = config;
    this.reset();
    this.client = isConfigured(config)
      ? new FoxessClient({
          apiKey: config.apiKey,
          request: this.request,
          minIntervalMs: this.minIntervalMs,
          now: this.now,
        })
      : null;
    this.stopped = false;
    if (!this.client) {
      logger.info('Not configured yet: waiting for the FoxESS Cloud API key');
      await this.setStatus('not-configured', false, TEXT.notConfiguredStatus);
      return;
    }
    await this.refresh({ force: true });
    this.schedule();
  }

  async reconfigure(config) {
    logger.info('New configuration received');
    await this.start(config);
  }

  /**
   * Gladys came back (it restarted, the socket dropped): it may have lost
   * what was published. Publish the devices and every state again, from the
   * readings in memory, then go on with the timer.
   */
  async resync(config) {
    if (!this.client || config.apiKey !== this.config.apiKey) {
      await this.start(config);
      return;
    }
    this.config = config;
    this.publishedSignature = null;
    this.statusKey = null;
    this.gladys.forgetPublishedStates();
    await this.refresh({ force: true });
    this.schedule();
  }

  stop() {
    this.stopped = true;
    this.stopTimer();
  }

  stopTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule() {
    this.stopTimer();
    if (!this.timers || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.refresh();
      } catch (err) {
        logger.error(`Reading cycle failed (${err.message})`);
      } finally {
        this.schedule();
      }
    }, this.refreshMs);
    this.timer.unref?.();
  }

  // --- Reading cycle --------------------------------------------------------------

  /**
   * One reading cycle; a second caller waits for the one in progress.
   * @param {{ force?: boolean }} [options] force: read the list and the settings again too
   */
  async refresh(options = {}) {
    if (this.running) {
      return this.running;
    }
    this.running = this.cycle(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async cycle({ force = false } = {}) {
    if (!this.client) {
      return;
    }
    const now = this.now();
    if (now < this.pausedUntil) {
      logger.debug(`Readings paused for ${Math.round((this.pausedUntil - now) / 1000)} s`);
      return;
    }
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: reading skipped');
      return;
    }
    this.lastCycleAt = now;
    const callsBefore = this.client.callCount;
    try {
      await this.readCloud(now, force);
      this.issues.ok('cloud', 'FoxESS Cloud answers again');
      if (this.missingSerials.length > 0) {
        await this.setStatus(
          `missing:${this.missingSerials}`,
          false,
          MESSAGES.serialsMissing(this.missingSerials.join(', ')),
        );
      } else if (this.selectedSerials().length === 0) {
        await this.setStatus('no-inverter', false, TEXT.noInverter);
      } else {
        await this.setStatus('ok', true);
      }
    } catch (err) {
      await this.handleCloudError(err, now);
      return;
    } finally {
      logger.debug(`Reading cycle: ${this.client.callCount - callsBefore} API call(s)`);
    }
    await this.publishAll();
  }

  /** The inverters of the configuration (all those of the account when none is typed). */
  selectedSerials() {
    const known = [...this.snapshots.keys()];
    const wanted = this.config.serialNumbers;
    return wanted.length === 0 ? known : known.filter((serial) => wanted.includes(serial));
  }

  /** The selected inverters the user added to Gladys. */
  createdSerials() {
    const created = new Set(
      (this.gladys.devices ?? []).map((device) => serialOfDevice(this.gladys, device.external_id)),
    );
    return this.selectedSerials().filter((serial) => created.has(serial));
  }

  async readCloud(now, force) {
    if (force || this.listReadAt === null || now - this.listReadAt >= this.timings.slowMs) {
      await this.readDeviceList();
      this.listReadAt = now;
    }

    // Every cycle: the added inverters; once: those never read (Discovery).
    const created = new Set(this.createdSerials());
    const toRead = this.selectedSerials().filter(
      (serial) => created.has(serial) || this.snapshots.get(serial).reading === null,
    );
    for (let i = 0; i < toRead.length; i += REAL_TIME_BATCH) {
      const batch = toRead.slice(i, i + REAL_TIME_BATCH);
      const entries = await this.client.realTime(batch);
      for (const entry of entries) {
        const reading = parseRealTime(entry);
        const snapshot = this.snapshots.get(reading.serial);
        if (snapshot) {
          snapshot.reading = reading;
        }
      }
    }

    for (const serial of created) {
      await this.readSlowValues(serial, now, force);
    }
  }

  async readDeviceList() {
    const devices = (await this.client.listDevices()).map(parseDevice).filter(Boolean);
    const seen = new Set();
    for (const inverter of devices) {
      seen.add(inverter.serial);
      const snapshot = this.snapshots.get(inverter.serial);
      if (snapshot) {
        this.logStatusChange(snapshot.inverter, inverter);
        snapshot.inverter = inverter;
      } else {
        this.snapshots.set(inverter.serial, {
          inverter,
          reading: null,
          generation: null,
          minSoc: null,
          minSocOnGrid: null,
          workMode: null,
        });
      }
    }
    for (const serial of [...this.snapshots.keys()]) {
      if (!seen.has(serial)) {
        this.snapshots.delete(serial);
      }
    }
    const missing = this.config.serialNumbers.filter((serial) => !seen.has(serial));
    if (missing.join() !== this.missingSerials.join() && missing.length > 0) {
      logger.warn(`Serial number(s) not on this FoxESS Cloud account: ${missing.join(', ')}`);
    }
    this.missingSerials = missing;
    if (this.statusKey === null) {
      logger.info(`FoxESS Cloud connected: ${devices.length} inverter(s) on the account`);
    }
  }

  /** An inverter going offline or coming back: lifecycle, one info line. */
  logStatusChange(previous, next) {
    if (previous.status === next.status || previous.status === null || next.status === null) {
      return;
    }
    logger.info(
      `Inverter ${next.model} ${shortSerial(next.serial)}: status ${previous.status} -> ${next.status} ` +
        '(1 online, 2 alarm, 3 offline)',
    );
  }

  /** Production of the day and lifetime, settings: on their slower paces. */
  async readSlowValues(serial, now, force) {
    const snapshot = this.snapshots.get(serial);
    const due = (map, period) => force || !map.has(serial) || now - map.get(serial) >= period;

    if (due(this.generationReadAt, this.timings.slowMs)) {
      this.generationReadAt.set(serial, now);
      await this.optional(
        `generation:${serial}`,
        `Production of ${shortSerial(serial)}`,
        async () => {
          snapshot.generation = parseGeneration(await this.client.generation(serial));
        },
      );
    }

    if (
      hasBattery(snapshot.inverter, snapshot.reading) &&
      due(this.settingsReadAt, this.timings.settingsMs)
    ) {
      this.settingsReadAt.set(serial, now);
      await this.optional(`soc:${serial}`, `Minimum charge of ${shortSerial(serial)}`, async () => {
        Object.assign(snapshot, parseMinSoc(await this.client.getMinSoc(serial)));
      });
      if (!this.workModeUnsupported.has(serial)) {
        await this.optional(`mode:${serial}`, `Work mode of ${shortSerial(serial)}`, async () => {
          try {
            snapshot.workMode = parseWorkMode(await this.client.getSetting(serial, 'WorkMode'));
          } catch (err) {
            if (err.kind === 'other' || err.kind === 'locked') {
              // This model or firmware does not expose it: not asked again.
              this.workModeUnsupported.add(serial);
              logger.debug(`Work mode not readable on ${shortSerial(serial)} (${err.message})`);
              return;
            }
            throw err;
          }
        });
      }
    }
  }

  /**
   * A call whose failure does not stop the cycle (the real-time values are
   * still published). A refused key or quota does: it applies to every call.
   */
  async optional(key, label, fn) {
    try {
      await fn();
      this.issues.ok(key, `${label}: read again`);
    } catch (err) {
      if (['auth', 'rate', 'signature'].includes(err.kind)) {
        throw err;
      }
      this.issues.fail(key, `${label}: not read (${err.message})`);
    }
  }

  async handleCloudError(err, now) {
    if (err.kind === 'rate') {
      this.pausedUntil = now + this.timings.ratePauseMs;
      this.issues.fail(
        'cloud',
        `FoxESS Cloud call limit reached, readings paused 30 min (${err.message})`,
      );
      await this.setStatus('rate', false, TEXT.quotaReached);
      return;
    }
    if (err.kind === 'auth') {
      this.pausedUntil = now + this.timings.authPauseMs;
      this.issues.fail('cloud', `FoxESS Cloud refused the API key (${err.message})`);
      await this.setStatus('auth', false, TEXT.keyRefused);
      return;
    }
    if (err.kind === 'signature') {
      this.pausedUntil = now + this.timings.authPauseMs;
      this.issues.fail('cloud', `FoxESS Cloud refused the request signature (${err.message})`);
      await this.setStatus('signature', false, TEXT.signatureRefused);
      return;
    }
    this.issues.fail('cloud', `FoxESS Cloud reading failed (${err.message})`);
    await this.setStatus('unreachable', false, TEXT.unreachable);
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async setStatus(key, connected, message) {
    if (this.statusKey === key) {
      return;
    }
    this.statusKey = key;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  // --- Publication ----------------------------------------------------------------

  /** The devices of the Discovery tab: every selected inverter. */
  buildDevices() {
    const serials = this.selectedSerials();
    const inverters = serials.map((serial) => this.snapshots.get(serial).inverter);
    const names = deviceNames(inverters);
    return serials.map((serial) => {
      const { inverter, reading } = this.snapshots.get(serial);
      return buildInverterDevice(this.gladys, inverter, reading, this.config, names.get(serial));
    });
  }

  /** Publish the devices when they changed, then the states of the added ones. */
  async publishAll() {
    await this.publishDevices();
    for (const serial of this.createdSerials()) {
      await this.publishStates(serial);
    }
  }

  async publishDevices({ always = false } = {}) {
    const devices = this.buildDevices();
    const signature = JSON.stringify(devices);
    if (!always && signature === this.publishedSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedSignature = signature;
      this.issues.ok('discovery', 'Devices published again');
    } catch (err) {
      this.issues.fail('discovery', `Publishing the devices failed (${err.message})`);
    }
  }

  async publishStates(serial) {
    const snapshot = this.snapshots.get(serial);
    if (!snapshot) {
      return;
    }
    const states = inverterStates(this.gladys, snapshot, this.config);
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      logger.debug(`${shortSerial(serial)}: ${count} state(s) published`);
      this.issues.ok(`states:${serial}`, `States of ${shortSerial(serial)} accepted again`);
    } catch (err) {
      this.issues.fail(
        `states:${serial}`,
        `States of ${shortSerial(serial)} refused (${err.message})`,
      );
    }
    await this.checkFault(serial);
  }

  /**
   * The `inverter_fault` scene trigger: a fault appears, or another one
   * replaces it. Never at start-up (a fault already there is not news), never
   * when it clears (the alarm feature says "None" for that).
   */
  async checkFault(serial) {
    const { inverter, reading } = this.snapshots.get(serial);
    if (!reading) {
      return;
    }
    const current =
      reading.fault || reading.faultCount > 0
        ? alarmText(inverter, reading, this.config.language)
        : null;
    const known = this.lastFault.has(serial);
    const previous = this.lastFault.get(serial);
    this.lastFault.set(serial, current);
    if (!known || current === null || current === previous) {
      return;
    }
    logger.info(`Inverter ${shortSerial(serial)} reports a fault: ${current}`);
    try {
      await this.gladys.publishSceneEvent(FAULT_TRIGGER, {
        device: inverterIds(this.gladys, serial).device,
        fault: current,
      });
    } catch (err) {
      logger.warn(`Fault event not sent (${err.message})`);
    }
  }

  // --- Gladys events ----------------------------------------------------------------

  /** Discovery tab: what is known now (the list is read on the timer). */
  async rediscover() {
    logger.info('Discovery requested');
    if (this.client && this.snapshots.size === 0) {
      await this.refresh({ force: true });
    }
    await this.publishDevices({ always: true });
  }

  /**
   * The user added (or updated) an inverter: Gladys drops the states of a
   * feature that did not exist, so everything is sent again now — from the
   * last reading, read first if there is none.
   */
  async onDeviceCreated(device) {
    const serial = serialOfDevice(this.gladys, device.external_id);
    const snapshot = serial ? this.snapshots.get(serial) : null;
    if (!snapshot) {
      return;
    }
    await this.running?.catch(() => {});
    if (snapshot.reading === null) {
      await this.refresh();
    } else if (this.client && this.now() >= this.pausedUntil) {
      // The production and settings are only read for added inverters.
      try {
        await this.readSlowValues(serial, this.now(), true);
      } catch (err) {
        await this.handleCloudError(err, this.now());
      }
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(serial);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The core's onPoll, a fallback: skipped when the timer has just read. */
  async pollDevice() {
    if (this.lastCycleAt !== null && this.now() - this.lastCycleAt < this.refreshMs * 0.9) {
      logger.debug('onPoll skipped: the timer has just read the cloud');
      return;
    }
    await this.refresh();
  }

  // --- Commands ----------------------------------------------------------------

  /** The snapshot of a device of this integration, or a thrown error. */
  commandTarget(deviceExternalId) {
    if (!this.config?.allowControl) {
      throw new Error(thrown(TEXT.controlDisabled));
    }
    if (!this.client) {
      throw new Error(thrown(TEXT.notConfiguredShort));
    }
    const serial = serialOfDevice(this.gladys, deviceExternalId);
    const snapshot = serial ? this.snapshots.get(serial) : null;
    if (!snapshot) {
      throw new Error(thrown(TEXT.unknownInverter));
    }
    if (!hasBattery(snapshot.inverter, snapshot.reading)) {
      throw new Error(thrown(TEXT.noBattery));
    }
    return snapshot;
  }

  commandError(err) {
    if (err.kind === 'locked') {
      return new Error(thrown(TEXT.scheduleActive, err.message));
    }
    return new Error(thrown(TEXT.commandFailed, err.message));
  }

  /**
   * @param {string} deviceExternalId
   * @param {string} mode one of WORK_MODES
   * @returns {Promise<object>} the result message, in the four languages
   */
  async setWorkMode(deviceExternalId, mode) {
    const snapshot = this.commandTarget(deviceExternalId);
    if (!WORK_MODES.includes(mode)) {
      throw new Error(thrown(TEXT.badMode));
    }
    const { serial } = snapshot.inverter;
    logger.info(`Setting the work mode of ${shortSerial(serial)} to ${mode}`);
    try {
      await this.client.setSetting(serial, 'WorkMode', mode);
    } catch (err) {
      logger.warn(`Work mode of ${shortSerial(serial)} refused (${err.message})`);
      throw this.commandError(err);
    }
    snapshot.workMode = mode;
    this.workModeUnsupported.delete(serial);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return MESSAGES.modeSet(mode);
  }

  /**
   * @param {string} deviceExternalId
   * @param {number} minSoc minimum charge off grid, 10 to 100 %
   * @param {number} minSocOnGrid minimum charge on grid, minSoc to 100 %
   */
  async setMinSoc(deviceExternalId, minSoc, minSocOnGrid) {
    const snapshot = this.commandTarget(deviceExternalId);
    const valid = (value) => Number.isInteger(value) && value >= 10 && value <= 100;
    if (!valid(minSoc) || !valid(minSocOnGrid) || minSocOnGrid < minSoc) {
      throw new Error(thrown(TEXT.badSoc));
    }
    const { serial } = snapshot.inverter;
    logger.info(
      `Setting the minimum charge of ${shortSerial(serial)} to ${minSoc} % / ${minSocOnGrid} % on grid`,
    );
    try {
      await this.client.setMinSoc(serial, minSoc, minSocOnGrid);
    } catch (err) {
      logger.warn(`Minimum charge of ${shortSerial(serial)} refused (${err.message})`);
      throw this.commandError(err);
    }
    snapshot.minSoc = minSoc;
    snapshot.minSocOnGrid = minSocOnGrid;
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return MESSAGES.minSocSet(minSoc, minSocOnGrid);
  }

  /** The "Test the connection" action: the inverters and the calls left today. */
  async testConnection() {
    logger.info('Action: test the connection');
    if (!this.client) {
      return MESSAGES.testFailed(TEXT.notConfiguredStatus);
    }
    try {
      const devices = (await this.client.listDevices()).map(parseDevice).filter(Boolean);
      if (devices.length === 0) {
        return MESSAGES.testFailed(TEXT.noInverter);
      }
      let quota = null;
      try {
        const count = await this.client.accessCount();
        if (count && count.remaining !== undefined && count.total !== undefined) {
          quota = `${count.remaining} / ${count.total}`;
        }
      } catch (err) {
        logger.debug(`Access count not available (${err.message})`);
      }
      const list = devices.map((d) => `${d.model} (${d.serial})`).join(', ');
      const message = MESSAGES.testOk(list, quota);
      const missing = this.config.serialNumbers.filter((s) => !devices.some((d) => d.serial === s));
      if (missing.length === 0) {
        return message;
      }
      const warning = MESSAGES.serialsMissing(missing.join(', '));
      return Object.fromEntries(
        Object.entries(message).map(([lang, text]) => [lang, `${text} ${warning[lang]}`]),
      );
    } catch (err) {
      logger.warn(`Connection test failed (${err.message})`);
      const reason =
        err.kind === 'auth'
          ? TEXT.keyRefused
          : err.kind === 'signature'
            ? TEXT.signatureRefused
            : err.kind === 'rate'
              ? TEXT.quotaReached
              : TEXT.unreachable;
      return MESSAGES.testFailed(reason);
    }
  }

  /** What the widget shows for one device: the snapshot, or null. */
  snapshotOf(deviceExternalId) {
    const serial = serialOfDevice(this.gladys, deviceExternalId);
    return serial ? (this.snapshots.get(serial) ?? null) : null;
  }
}
