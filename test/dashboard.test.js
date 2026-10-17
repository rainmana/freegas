import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import http from 'node:http';
import { FuelRouter } from '../src/router.js';
import { createServer } from '../src/server.js';
import { openDashboard } from '../src/browser.js';

const provider = (id, extra = {}) => ({ id, baseUrl: 'https://example.org/v1', models: [{ id: 'coder', tasks: ['code'], capabilities: ['tools'], offer: 'free', priority: 50, context: 32000 }], ...extra });
const request = { model: 'freegas/code', messages: [{ role: 'user', content: 'private prompt' }] };
function router(providers, fetchImpl = async () => new Response('{}')) {
  return new FuelRouter({ config: { allowTrials: false, timeoutMs: 1000 }, env: { PRIVATE_KEY: 'private credential' }, providers }, { fetchImpl });
}
async function listen(t, r, options) {
  const server = createServer(r, options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('dashboard starts with honest untested, missing-key, and trial-disabled states', () => {
  const trial = provider('trial'); trial.models[0].offer = 'trial';
  const r = router([provider('available'), provider('missing', { keyEnv: 'NO_SUCH_KEY' }), trial]);
  const snapshot = r.snapshot();
  assert.deepEqual(snapshot.stations.map(s => s.status), ['unverified', 'missing_key', 'trial_disabled']);
  assert.deepEqual(snapshot.stations.map(s => s.configured), [true, false, false]);
  assert.equal(snapshot.stations[0].latencyMs, null); assert.equal(snapshot.totals.requests, 0); assert.deepEqual(snapshot.activity, []);
});

test('live snapshots reflect fallback, active streams, completion, and expiring cooldowns', async () => {
  let now = 1000; let calls = 0;
  const r = router([provider('dry'), provider('working')], async () => ++calls === 1 ? new Response('private upstream body', { status: 429, headers: { 'retry-after': '2' } }) : new Response('{}'));
  r.now = () => now;
  const result = await r.route(request);
  let data = r.snapshot();
  assert.equal(data.stations[0].status, 'cooldown'); assert.equal(data.stations[1].status, 'in_flight');
  assert.equal(data.totals.completed, 0); assert.equal(data.totals.attempts, 2); assert.equal(data.totals.fallbacks, 1);
  assert.equal(data.stations[1].latencyMs, 0);
  assert.deepEqual(data.activity.map(e => e.type), ['attempt', 'cooldown', 'fallback', 'attempt', 'accepted']);
  result.finish(); result.finish(); data = r.snapshot();
  assert.equal(data.totals.completed, 1); assert.equal(data.stations[1].status, 'observed_success'); assert.equal(data.stations[1].inFlight, 0);
  now = 3000; assert.equal(r.snapshot().stations[0].status, 'last_request_failed');
  assert.doesNotMatch(JSON.stringify(data), /private prompt|private upstream body|private credential|PRIVATE_KEY/);
});

test('telemetry distinguishes failed and cancelled accepted responses and bounds event history', async () => {
  const r = router([provider('local')]);
  const failed = await r.route(request); failed.finish('failed');
  assert.equal(r.snapshot().stations[0].status, 'last_request_failed');
  const cancelled = await r.route(request); cancelled.finish('cancelled');
  assert.equal(r.snapshot().stations[0].status, 'last_request_cancelled');
  for (let i = 0; i < 40; i++) { const result = await r.route(request); result.finish(); }
  const snapshot = r.snapshot();
  assert.equal(snapshot.totals.completed, 40); assert.equal(snapshot.totals.failed, 1); assert.equal(snapshot.totals.cancelled, 1);
  assert.equal(snapshot.activity.length, 100); assert.ok(snapshot.activity[0].id > 1);
  snapshot.totals.completed = -1; snapshot.activity[0].type = 'tampered'; snapshot.stations[0].tasks.push('tampered');
  assert.equal(r.snapshot().totals.completed, 40); assert.notEqual(r.snapshot().activity[0].type, 'tampered'); assert.deepEqual(r.snapshot().stations[0].tasks, ['code']);
});

test('dashboard assets are public, status is authenticated, and foreign browser/host access is blocked', async t => {
  const base = await listen(t, router([provider('local')]), { token: 'local-token' });
  for (const [path, type] of [['/', 'text/html'], ['/dashboard.js', 'text/javascript'], ['/dashboard.css', 'text/css'], ['/icon.png', 'image/png']]) {
    const response = await fetch(base + path); assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await fetch(base + '/api/status')).status, 401);
  assert.equal((await fetch(base + '/api/status', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const headers = { authorization: 'Bearer local-token', origin: base };
  const response = await fetch(base + '/api/status', { headers }); assert.equal(response.status, 200); assert.equal((await response.json()).stations.length, 1);
  for (const changes of [{ origin: 'https://foreign.example' }, { 'sec-fetch-site': 'cross-site' }, { host: 'rebind.example' }]) {
    // Native HTTP preserves deliberately hostile Host headers; fetch may rewrite them.
    const status = await new Promise((resolve, reject) => http.get(base + '/api/status', { headers: { ...headers, ...changes } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
    assert.equal(status, 403, JSON.stringify(changes));
  }
  assert.equal((await fetch(base + '/', { headers: { origin: 'null' } })).status, 403);
  assert.equal((await fetch(base + '/v1/models', { headers })).status, 403);
  assert.equal((await fetch(base + '/dashboard.html')).status, 401);
});

test('invalid upstream body types are recorded as failed trips, never successes', async t => {
  const r = router([provider('local')], async () => new Response('private html', { headers: { 'content-type': 'text/html' } }));
  const base = await listen(t, r);
  const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(response.status, 502);
  const data = await (await fetch(base + '/api/status')).json();
  assert.equal(data.totals.completed, 0); assert.equal(data.totals.failed, 1); assert.equal(data.stations[0].status, 'last_request_failed');
  assert.doesNotMatch(JSON.stringify(data), /private html|private prompt/);
});

test('browser opening uses platform launchers without a shell and handles unavailable browsers', () => {
  for (const [platform, command] of [['win32', 'rundll32.exe'], ['darwin', 'open'], ['linux', 'xdg-open']]) {
    let errors = 0; let unrefs = 0; const child = new EventEmitter(); child.unref = () => unrefs++;
    openDashboard('http://127.0.0.1:4040/', { platform, spawnImpl: (cmd, args, options) => {
      assert.equal(cmd, command); assert.equal(args.at(-1), 'http://127.0.0.1:4040/'); assert.equal(options.shell, false); return child;
    }, onError: () => errors++ });
    child.emit('exit', 0); child.emit('error', new Error('no browser')); assert.equal(errors, 1); assert.equal(unrefs, 1);
  }
  let errors = 0; const child = new EventEmitter(); child.unref = () => {};
  openDashboard('http://127.0.0.1:4040/', { spawnImpl: () => child, onError: () => errors++ }); child.emit('exit', 1); assert.equal(errors, 1);
  openDashboard('http://127.0.0.1:4040/', { spawnImpl: () => { throw new Error('unavailable'); }, onError: () => errors++ }); assert.equal(errors, 2);
  const quiet = new EventEmitter(); quiet.unref = () => {};
  openDashboard('http://127.0.0.1:4040/', { spawnImpl: () => quiet }); quiet.emit('error', new Error('ignored'));
});
