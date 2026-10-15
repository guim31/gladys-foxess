// -----------------------------------------------------------------------------
// FoxESS Cloud Open API client (https://www.foxesscloud.com/op/...).
//
// Authentication: the API key the user creates in the FoxESS Cloud profile
// (User Profile → API Management) goes in the `token` header, with the
// current time in milliseconds (`timestamp`) and `signature`, the lowercase
// hex MD5 of `path + "\r\n" + token + "\r\n" + timestamp`, where `\r\n` is
// the FOUR literal characters backslash, r, backslash, n — not a CRLF. The
// official document reads like a CRLF; real CRLF bytes are refused (errno
// 40256). `path` is the request path without the query string.
//
// Every answer is an envelope `{ errno, msg, result }`; errno 0 is success.
// The calls are serialized and spaced by one second at least: the Open API
// refuses bursts (errno 40400) and allows 1,440 calls a day.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { httpRequest } from './http.js';

export const BASE_URL = 'https://www.foxesscloud.com';

/** Minimum gap between two calls, in ms. */
export const MIN_CALL_INTERVAL_MS = 1_000;

export const PATHS = {
  deviceList: '/op/v0/device/list',
  realTime: '/op/v1/device/real/query',
  generation: '/op/v0/device/generation',
  socGet: '/op/v0/device/battery/soc/get',
  socSet: '/op/v0/device/battery/soc/set',
  settingGet: '/op/v0/device/setting/get',
  settingSet: '/op/v0/device/setting/set',
  accessCount: '/op/v0/user/getAccessCount',
};

// Error numbers of the Open API that change what the integration does
// (the full table is in the Open API document).
export const ERRNO = {
  BAD_HEADER: 40256, // signature, timestamp or header refused
  BAD_PARAMETER: 40257,
  TOO_FREQUENT: 40400,
  LOGIN_TOO_FREQUENT: 40401,
  OVER_LIMIT: 40402,
  TOKEN_INVALID: 41808,
  TOKEN_ILLEGAL: 41809,
  NO_PERMISSION: 41811,
  DEVICE_NOT_FOUND: 41930,
  NO_VERIFIED_SN: 41931,
  INVALID_SN: 41932,
  DEVICE_OFFLINE: 41935,
  UNSUPPORTED_FUNCTION: 44096, // also: a schedule is active, settings are locked
};

const AUTH_ERRNOS = new Set([ERRNO.TOKEN_INVALID, ERRNO.TOKEN_ILLEGAL, ERRNO.NO_PERMISSION]);
const RATE_ERRNOS = new Set([ERRNO.TOO_FREQUENT, ERRNO.LOGIN_TOO_FREQUENT, ERRNO.OVER_LIMIT]);
const DEVICE_ERRNOS = new Set([ERRNO.DEVICE_NOT_FOUND, ERRNO.NO_VERIFIED_SN, ERRNO.INVALID_SN]);

/** The cloud answered, but with a non-zero errno. */
export class FoxessApiError extends Error {
  constructor(errno, msg, path) {
    super(`FoxESS Cloud error ${errno}${msg ? ` (${msg})` : ''} on ${path}`);
    this.name = 'FoxessApiError';
    this.errno = errno;
    this.path = path;
    this.kind = AUTH_ERRNOS.has(errno)
      ? 'auth'
      : RATE_ERRNOS.has(errno)
        ? 'rate'
        : errno === ERRNO.BAD_HEADER
          ? 'signature'
          : DEVICE_ERRNOS.has(errno)
            ? 'device'
            : errno === ERRNO.UNSUPPORTED_FUNCTION
              ? 'locked'
              : 'other';
  }
}

/** No usable answer: network error, HTTP error, body that is not the envelope. */
export class FoxessHttpError extends Error {
  constructor(message, path) {
    super(`FoxESS Cloud unreachable on ${path}: ${message}`);
    this.name = 'FoxessHttpError';
    this.kind = 'network';
    this.path = path;
  }
}

/**
 * The gateway in front of `/op/` refused the request at the HTTP level:
 * an unknown or revoked key gets a 401 with an empty body, no errno (seen on
 * the live cloud, 2026-10-15). A wrong signature gets the same answer, so the
 * two cannot be told apart without a valid key.
 */
export class FoxessAuthError extends Error {
  constructor(status, path) {
    super(`FoxESS Cloud refused the API key on ${path} (HTTP ${status})`);
    this.name = 'FoxessAuthError';
    this.kind = 'auth';
    this.status = status;
    this.path = path;
  }
}

/**
 * The Open API signature (see the header of this file).
 * @param {string} path request path, without the query string
 * @param {string} token API key
 * @param {string} timestamp milliseconds, as sent in the header
 */
export function sign(path, token, timestamp) {
  return createHash('md5').update(`${path}\\r\\n${token}\\r\\n${timestamp}`, 'utf8').digest('hex');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FoxessClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {Function} [options.request] the HTTP seam (src/foxess/http.js)
   * @param {() => number} [options.now] clock, for the timestamp
   * @param {number} [options.minIntervalMs] gap between two calls
   * @param {string} [options.baseUrl]
   */
  constructor({
    apiKey,
    request = httpRequest,
    now = () => Date.now(),
    minIntervalMs = MIN_CALL_INTERVAL_MS,
    baseUrl = BASE_URL,
  }) {
    this.apiKey = apiKey;
    this.request = request;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.baseUrl = baseUrl;
    this.queue = Promise.resolve();
    this.lastCallAt = 0;
    /** Calls sent since start, by path: shown at debug, used by the tests. */
    this.calls = new Map();
  }

  /** Total number of calls sent. */
  get callCount() {
    let total = 0;
    for (const count of this.calls.values()) {
      total += count;
    }
    return total;
  }

  /**
   * One signed call, queued behind the others.
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {{ query?: Record<string, string>, body?: object }} [options]
   * @returns {Promise<any>} the `result` of the envelope
   */
  call(method, path, options = {}) {
    const run = this.queue.then(() => this.send(method, path, options));
    // The queue goes on whatever this call gives.
    this.queue = run.catch(() => {});
    return run;
  }

  async send(method, path, { query, body } = {}) {
    const wait = this.lastCallAt + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastCallAt = Date.now();
    this.calls.set(path, (this.calls.get(path) ?? 0) + 1);

    const timestamp = String(Math.round(this.now()));
    const headers = {
      token: this.apiKey,
      timestamp,
      signature: sign(path, this.apiKey, timestamp),
      lang: 'en',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; gladys-foxess)',
    };
    const search = query ? `?${new URLSearchParams(query)}` : '';
    let response;
    try {
      response = await this.request(`${this.baseUrl}${path}${search}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new FoxessHttpError(err.cause?.code ?? err.code ?? err.message, path);
    }
    if (response.status === 401 || response.status === 403) {
      throw new FoxessAuthError(response.status, path);
    }
    if (response.status !== 200) {
      throw new FoxessHttpError(`HTTP ${response.status}`, path);
    }
    let envelope;
    try {
      envelope = JSON.parse(response.text);
    } catch {
      throw new FoxessHttpError('the answer is not JSON', path);
    }
    if (!envelope || typeof envelope !== 'object' || !Number.isInteger(envelope.errno)) {
      throw new FoxessHttpError('the answer is not an Open API envelope', path);
    }
    if (envelope.errno !== 0) {
      throw new FoxessApiError(
        envelope.errno,
        typeof envelope.msg === 'string' ? envelope.msg : '',
        path,
      );
    }
    return envelope.result;
  }

  // --- Endpoints --------------------------------------------------------------

  /** Every inverter of the account: `[{ deviceSN, deviceType, hasBattery, status, ... }]`. */
  async listDevices() {
    const devices = [];
    const pageSize = 100;
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.call('POST', PATHS.deviceList, {
        body: { currentPage: page, pageSize },
      });
      const data = Array.isArray(result?.data) ? result.data : [];
      devices.push(...data);
      const total = Number(result?.total);
      if (data.length < pageSize || !Number.isFinite(total) || devices.length >= total) {
        break;
      }
    }
    return devices;
  }

  /**
   * The real-time values of several inverters in one call (v1 endpoint).
   * @param {string[]} serials
   * @returns {Promise<Array<{ deviceSN: string, time?: string, datas: object[] }>>}
   */
  async realTime(serials) {
    const result = await this.call('POST', PATHS.realTime, { body: { sns: serials } });
    return Array.isArray(result) ? result : [];
  }

  /** Today's, this month's and the lifetime production, in kWh. */
  generation(serial) {
    return this.call('GET', PATHS.generation, { query: { sn: serial } });
  }

  /** `{ minSoc, minSocOnGrid }`, in %. */
  getMinSoc(serial) {
    return this.call('GET', PATHS.socGet, { query: { sn: serial } });
  }

  setMinSoc(serial, minSoc, minSocOnGrid) {
    return this.call('POST', PATHS.socSet, { body: { sn: serial, minSoc, minSocOnGrid } });
  }

  /** One named setting, e.g. `WorkMode`: `{ value, ... }`. */
  getSetting(serial, key) {
    return this.call('POST', PATHS.settingGet, { body: { sn: serial, key } });
  }

  setSetting(serial, key, value) {
    return this.call('POST', PATHS.settingSet, { body: { sn: serial, key, value: String(value) } });
  }

  /** The API calls left today: `{ total, remaining }` (shape not documented). */
  accessCount() {
    return this.call('GET', PATHS.accessCount);
  }
}
