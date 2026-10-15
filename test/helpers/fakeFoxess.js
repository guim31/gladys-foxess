// -----------------------------------------------------------------------------
// An in-memory FoxESS Cloud behind the `request` seam of the client
// (src/foxess/http.js). It checks what the real one checks — the signature
// with its literal "\r\n", the API key, a timestamp within a minute — and
// answers from the fixtures of test/fixtures/foxess/. Its state is editable:
// the inverters, their readings, a daily quota, a cloud that does not answer.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/foxess/${name}.json`, import.meta.url), 'utf8'));

export const API_KEY = 'test-api-key-0123456789abcdef';
export const SN_HYBRID = '60BH50000000001';
export const SN_SOLAR = '60T1000000000002';

const ok = (result) => ({
  status: 200,
  text: JSON.stringify({ errno: 0, msg: 'success', result }),
});
const fail = (errno, msg = '') => ({
  status: 200,
  text: JSON.stringify({ errno, msg, result: null }),
});

export class FakeFoxess {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] the key the account accepts
   * @param {() => number} [options.now] clock, to check the timestamp
   * @param {number} [options.dailyQuota] calls per day before 40400
   */
  constructor({ apiKey = API_KEY, now = () => Date.now(), dailyQuota = Infinity } = {}) {
    this.apiKey = apiKey;
    this.now = now;
    this.dailyQuota = dailyQuota;
    this.devices = structuredClone(fixture('device-list').result.data);
    this.readings = new Map(
      fixture('real-query').result.map((entry) => [entry.deviceSN, structuredClone(entry)]),
    );
    this.generation = new Map([
      [SN_HYBRID, structuredClone(fixture('generation').result)],
      [SN_SOLAR, { today: 30.2, month: 512.9, cumulative: 20450.3 }],
    ]);
    this.minSoc = new Map([[SN_HYBRID, structuredClone(fixture('soc-get').result)]]);
    this.workMode = new Map([[SN_HYBRID, 'SelfUse']]);
    this.scheduleActive = false;
    this.online = true;
    this.requests = [];
    /** Errors forced on a path: path -> errno (once, or every time with `sticky`). */
    this.forced = new Map();
  }

  /** Force an errno on the next calls to `path` (all of them when sticky). */
  failOn(path, errno, { sticky = false } = {}) {
    this.forced.set(path, { errno, sticky });
  }

  /** Change one real-time variable of an inverter. */
  setVariable(serial, variable, value) {
    const entry = this.readings.get(serial);
    const data = entry.datas.find((d) => d.variable === variable);
    if (data) {
      data.value = value;
    } else {
      entry.datas.push({ variable, value, unit: '', name: variable });
    }
  }

  setStatus(serial, status) {
    this.devices.find((d) => d.deviceSN === serial).status = status;
  }

  countOf(path) {
    return this.requests.filter((r) => r.path === path).length;
  }

  /** The `request` function given to the client. */
  handle = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const { pathname, searchParams } = new URL(url);
    const json = body === undefined ? undefined : JSON.parse(body);
    this.requests.push({
      method,
      path: pathname,
      query: Object.fromEntries(searchParams),
      body: json,
      headers,
    });
    if (!this.online) {
      const error = new Error('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }

    // The checks of the real cloud, in its order.
    const expected = createHash('md5')
      .update(`${pathname}\\r\\n${headers.token}\\r\\n${headers.timestamp}`)
      .digest('hex');
    if (!headers.token || !headers.timestamp || headers.signature !== expected) {
      return fail(40256, 'illegal signature');
    }
    if (Math.abs(Number(headers.timestamp) - this.now()) > 60_000) {
      return fail(40256, 'illegal timestamp');
    }
    if (headers.token !== this.apiKey) {
      return fail(41808, 'Token is invalid');
    }
    if (this.requests.length > this.dailyQuota) {
      return fail(40400, 'Your requests are too frequent. Please try again later');
    }
    const forced = this.forced.get(pathname);
    if (forced) {
      if (!forced.sticky) {
        this.forced.delete(pathname);
      }
      return fail(forced.errno, 'forced');
    }
    return this.route(method, pathname, searchParams, json);
  };

  route(method, path, query, body) {
    const known = (serial) => this.devices.some((d) => d.deviceSN === serial);
    switch (`${method} ${path}`) {
      case 'POST /op/v0/device/list': {
        const pageSize = body?.pageSize ?? 10;
        const page = body?.currentPage ?? 1;
        return ok({
          currentPage: page,
          pageSize,
          total: this.devices.length,
          data: structuredClone(this.devices.slice((page - 1) * pageSize, page * pageSize)),
        });
      }
      case 'POST /op/v1/device/real/query': {
        const serials = body?.sns;
        if (!Array.isArray(serials) || serials.length === 0) {
          return fail(40257, 'Parameter does not meet expectations');
        }
        if (!serials.every(known)) {
          return fail(41930, 'Device does not exist or has been used by other');
        }
        return ok(
          serials.map((serial) => structuredClone(this.readings.get(serial))).filter(Boolean),
        );
      }
      case 'GET /op/v0/device/generation': {
        const serial = query.get('sn');
        return known(serial) ? ok(structuredClone(this.generation.get(serial) ?? {})) : fail(41930);
      }
      case 'GET /op/v0/device/battery/soc/get': {
        const serial = query.get('sn');
        return this.minSoc.has(serial)
          ? ok(structuredClone(this.minSoc.get(serial)))
          : fail(41200, 'Query data failed');
      }
      case 'POST /op/v0/device/battery/soc/set': {
        if (this.scheduleActive) {
          return fail(44096, 'Unsupported function code');
        }
        if (
          !this.minSoc.has(body?.sn) ||
          !Number.isInteger(body.minSoc) ||
          !Number.isInteger(body.minSocOnGrid)
        ) {
          return fail(40257, 'Parameter does not meet expectations');
        }
        this.minSoc.set(body.sn, { minSoc: body.minSoc, minSocOnGrid: body.minSocOnGrid });
        return ok(null);
      }
      case 'POST /op/v0/device/setting/get': {
        if (body?.key !== 'WorkMode' || !this.workMode.has(body?.sn)) {
          return fail(40257, 'Parameter does not meet expectations');
        }
        return ok({ value: this.workMode.get(body.sn), unit: '', precision: 1, range: null });
      }
      case 'POST /op/v0/device/setting/set': {
        if (this.scheduleActive) {
          return fail(44096, 'Unsupported function code');
        }
        if (
          body?.key !== 'WorkMode' ||
          !this.workMode.has(body?.sn) ||
          typeof body.value !== 'string'
        ) {
          return fail(40257, 'Parameter does not meet expectations');
        }
        this.workMode.set(body.sn, body.value);
        return ok(null);
      }
      case 'GET /op/v0/user/getAccessCount':
        return ok(structuredClone(fixture('access-count').result));
      default:
        return { status: 404, text: '<html>Not Found</html>' };
    }
  }
}
