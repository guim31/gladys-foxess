// -----------------------------------------------------------------------------
// The Open API client: the signature (literal "\r\n", the reference value
// computed by the Python clients' `fr"{path}\r\n{token}\r\n{timestamp}"`),
// the envelope, the error kinds, the spacing of the calls, the pagination.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FoxessClient, PATHS, sign } from '../src/foxess/client.js';
import { API_KEY, FakeFoxess, SN_HYBRID } from './helpers/fakeFoxess.js';

const client = (cloud, options = {}) =>
  new FoxessClient({ apiKey: API_KEY, request: cloud.handle, minIntervalMs: 0, ...options });

test('the signature joins path, key and time with the four characters \\r\\n', () => {
  // hashlib.md5(fr'/op/v0/device/real/query\r\nabcdef0123456789\r\n1715000000000'.encode())
  assert.equal(
    sign('/op/v0/device/real/query', 'abcdef0123456789', '1715000000000'),
    'd52b7db06d125b73c38a5754da285923',
  );
  // Real CRLF bytes give another digest: the cloud answers 40256.
  assert.notEqual(
    sign('/op/v0/device/real/query', 'abcdef0123456789', '1715000000000'),
    'de8bf5bfca2b98090a6ec0932ce58bac',
  );
});

test('the headers carry the key, the time, the signature; the path is signed without the query', async () => {
  const cloud = new FakeFoxess();
  const result = await client(cloud).generation(SN_HYBRID);
  assert.equal(result.cumulative, 8123.5);
  const [request] = cloud.requests;
  assert.equal(request.path, PATHS.generation);
  assert.deepEqual(request.query, { sn: SN_HYBRID });
  assert.equal(request.headers.token, API_KEY);
  assert.equal(
    request.headers.signature,
    sign(PATHS.generation, API_KEY, request.headers.timestamp),
  );
  assert.equal(request.headers['Content-Type'], 'application/json');
});

test('a refused key, a burst, a refused signature and an unknown device have their kind', async () => {
  const cases = [
    [new FakeFoxess({ apiKey: 'another-key' }), 'auth', 41808],
    [new FakeFoxess({ dailyQuota: 0 }), 'rate', 40400],
    [new FakeFoxess({ now: () => Date.now() + 5 * 60_000 }), 'signature', 40256],
  ];
  for (const [cloud, kind, errno] of cases) {
    await assert.rejects(client(cloud).listDevices(), (err) => {
      assert.equal(err.kind, kind);
      assert.equal(err.errno, errno);
      assert.ok(!err.message.includes(API_KEY), 'never the key in an error');
      return true;
    });
  }
  const cloud = new FakeFoxess();
  await assert.rejects(client(cloud).realTime(['NOTMYINVERTER1']), {
    kind: 'device',
    errno: 41930,
  });
  cloud.scheduleActive = true;
  await assert.rejects(client(cloud).setSetting(SN_HYBRID, 'WorkMode', 'Feedin'), {
    kind: 'locked',
  });
});

test('a cloud that does not answer, an HTML page or an HTTP error are network errors', async () => {
  const down = new FakeFoxess();
  down.online = false;
  await assert.rejects(client(down).listDevices(), { kind: 'network', message: /ECONNREFUSED/ });

  const html = new FakeFoxess();
  await assert.rejects(client(html).call('GET', '/op/v0/unknown'), {
    kind: 'network',
    message: /HTTP 404/,
  });

  const garbage = { handle: async () => ({ status: 200, text: '<html>maintenance</html>' }) };
  await assert.rejects(client(garbage).listDevices(), { kind: 'network', message: /not JSON/ });
  const noEnvelope = { handle: async () => ({ status: 200, text: '{"data":[]}' }) };
  await assert.rejects(client(noEnvelope).listDevices(), { message: /not an Open API envelope/ });
});

test('the calls are serialized and spaced by the minimum interval', async () => {
  const cloud = new FakeFoxess();
  const times = [];
  const original = cloud.handle;
  cloud.handle = async (...args) => {
    times.push(Date.now());
    return original(...args);
  };
  const api = client(cloud, { minIntervalMs: 40 });
  await Promise.all([
    api.generation(SN_HYBRID),
    api.generation(SN_HYBRID),
    api.getMinSoc(SN_HYBRID),
  ]);
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 35, `gap ${times[1] - times[0]} ms`);
  assert.ok(times[2] - times[1] >= 35, `gap ${times[2] - times[1]} ms`);
  assert.equal(api.callCount, 3);
});

test('a failed call does not block the next ones', async () => {
  const cloud = new FakeFoxess();
  cloud.failOn(PATHS.generation, 41200);
  const api = client(cloud);
  await assert.rejects(api.generation(SN_HYBRID), { errno: 41200, kind: 'other' });
  assert.equal((await api.getMinSoc(SN_HYBRID)).minSoc, 10);
});

test('the device list is read page by page', async () => {
  const cloud = new FakeFoxess();
  for (let i = 0; i < 150; i += 1) {
    cloud.devices.push({
      deviceSN: `60XX${String(i).padStart(11, '0')}`,
      deviceType: 'F3000',
      status: 3,
    });
  }
  const devices = await client(cloud).listDevices();
  assert.equal(devices.length, 152);
  assert.equal(cloud.countOf(PATHS.deviceList), 2);
});

test('the real-time values are asked for several inverters in one call', async () => {
  const cloud = new FakeFoxess();
  const entries = await client(cloud).realTime(['60BH50000000001', '60T1000000000002']);
  assert.equal(entries.length, 2);
  assert.deepEqual(cloud.requests[0].body, { sns: ['60BH50000000001', '60T1000000000002'] });
});
