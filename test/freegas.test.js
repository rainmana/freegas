import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FuelRouter } from '../src/router.js';
import { createServer } from '../src/server.js';
import { validatePack } from '../src/config.js';

const model = (overrides = {}) => ({ id: 'test-model', offer: 'free', priority: 50, context: 32000, tasks: ['code'], capabilities: ['tools', 'json'], ...overrides });
const provider = (id, baseUrl = 'https://example.com/v1', overrides = {}) => ({ id, baseUrl, models: [model()], ...overrides });
const setup = (providers, options = {}, extra = {}) => new FuelRouter({ providers, env: { TEST_KEY: 'fake-secret' }, config: { allowTrials: false, timeoutMs: 500, ...extra } }, options);
const request = (extra = {}) => ({ model: 'freegas/code', messages: [{ role: 'user', content: 'write code' }], ...extra });
async function listen(server, t) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP: 429 falls through, rewrites model, keeps tools, replaces client credentials, observes cooldown', async t => {
  let firstCalls = 0; const received = [];
  const first = await listen(http.createServer((req, res) => { firstCalls++; res.writeHead(429, { 'retry-after': '60' }); res.end('secret upstream error'); }), t);
  const second = await listen(http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received.push({ body: JSON.parse(raw), auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }));
  }), t);
  const router = setup([provider('a', first), provider('b', second, { keyEnv: 'TEST_KEY' })]);
  const base = await listen(createServer(router, { token: 'local-token' }), t);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer local-token' }, body: JSON.stringify(request({ tools: [{ type: 'function', function: { name: 'read_file' } }] })) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-freegas-provider'), 'b');
    assert.equal((await response.json()).choices[0].message.content, 'hello');
  }
  assert.equal(firstCalls, 1); assert.equal(received.length, 2);
  assert.equal(received[0].body.model, 'test-model'); assert.equal(received[0].body.tools[0].function.name, 'read_file');
  assert.equal(received[0].auth, 'Bearer fake-secret');
});

test('selection filters keys, trials, task, tools, vision and context; priority wins', () => {
  const router = setup([
    provider('no-key', undefined, { keyEnv: 'MISSING' }),
    provider('trial', undefined, { models: [model({ offer: 'trial' })] }),
    provider('short', undefined, { models: [model({ context: 5 })] }),
    provider('no-tools', undefined, { models: [model({ capabilities: [] })] }),
    provider('good'), provider('best', undefined, { models: [model({ priority: 90 })] }),
  ]);
  assert.deepEqual(router.candidates(request({ tools: [{}] })).map(r => r.p.id), ['best', 'good']);
  assert.equal(router.candidates(request({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] })).length, 0);
  assert.equal(router.candidates(request({ model: 'freegas/research' })).length, 0);
  assert.throws(() => router.candidates(request({ model: 'expensive-model' })), /pump does not exist/);
});

test('bad request does not fall back and releases occupancy', async () => {
  let calls = 0;
  const router = setup([provider('a'), provider('b')], { fetchImpl: async () => { calls++; return new Response('private', { status: 400 }); } });
  await assert.rejects(router.route(request()), { status: 400 });
  assert.equal(calls, 1); assert.equal(router.health.get('a/test-model').inFlight, 0);
});

test('auth, quota, unavailable model and server failures move on; exhausted pool is bounded', async () => {
  for (const status of [401, 402, 403, 404, 408, 429, 500, 503]) {
    let calls = 0;
    const router = setup([provider('a'), provider('b')], { fetchImpl: async () => { calls++; return new Response('private', { status }); } });
    await assert.rejects(router.route(request()), { code: 'all_pumps_busy' });
    assert.equal(calls, 2);
    await assert.rejects(router.route(request()), { code: 'empty_tank' });
    assert.equal(calls, 2);
  }
});

test('timeout falls back; credentials are not followed across redirects', async t => {
  let leaked = false;
  const target = await listen(http.createServer((req, res) => { leaked = true; res.end(); }), t);
  const redirect = await listen(http.createServer((req, res) => { res.writeHead(302, { location: target }); res.end(); }), t);
  const router = setup([provider('a', redirect, { keyEnv: 'TEST_KEY' }), provider('b')], { fetchImpl: async (url, opts) => url.startsWith(redirect) ? fetch(url, opts) : new Response('{}', { headers: { 'content-type': 'application/json' } }) });
  const routed = await router.route(request()); routed.finish(); assert.equal(routed.provider, 'b'); assert.equal(leaked, false);
  const timed = setup([provider('a'), provider('b', undefined, { keyEnv: 'TEST_KEY' })], { fetchImpl: async (url, opts) => {
    if (JSON.parse(opts.body).model === 'test-model' && !opts.headers.authorization) return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
    return new Response('{}');
  } }, { timeoutMs: 10 });
  const afterTimeout = await timed.route(request()); afterTimeout.finish();
  assert.equal(afterTimeout.provider, 'b');
});

test('SSE bytes pass through; interrupted stream never replays at another provider', async t => {
  let calls = 0;
  const upstream = await listen(http.createServer((req, res) => {
    calls++; res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}\n\n');
    setTimeout(() => res.end('data: [DONE]\n\n'), 5);
  }), t);
  const base = await listen(createServer(setup([provider('a', upstream), provider('b', upstream)])), t);
  const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request({ stream: true })) });
  assert.match(await response.text(), /tool_calls.*\n\ndata: \[DONE\]/); assert.equal(calls, 1);
  let attempts = 0;
  const brokenRouter = setup([provider('a'), provider('b')], { fetchImpl: async () => {
    attempts++;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {}\n\n')); setTimeout(() => c.error(new Error('broken')), 10); } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const brokenBase = await listen(createServer(brokenRouter), t);
  await assert.rejects(async () => { const r = await fetch(`${brokenBase}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request({ stream: true })) }); await r.text(); });
  assert.equal(attempts, 1);
});

test('HTTP boundary: authentication, browser block, malformed JSON, models, oversized body', async t => {
  let calls = 0;
  const base = await listen(createServer(setup([provider('a')], { fetchImpl: async () => { calls++; return new Response('{}'); } }), { token: 'test' }), t);
  assert.equal((await fetch(`${base}/v1/models`)).status, 401);
  assert.equal((await fetch(`${base}/v1/models`, { headers: { authorization: 'Bearer test', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/v1/models`, { headers: { authorization: 'Bearer test' } })).status, 200);
  for (const [body, status] of [['{', 400], ['{}', 400], ['x'.repeat(2 * 1024 * 1024 + 1), 413]]) {
    const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test' }, body });
    assert.equal(r.status, status);
  }
  assert.equal(calls, 0);
});

test('invalid upstream content type cancels an indefinitely open response before returning 502', async t => {
  for (const type of ['text/html', undefined]) {
    let closed;
    const upstream = await listen(http.createServer((req, res) => {
      closed = once(res, 'close', { signal: AbortSignal.timeout(2000) });
      res.writeHead(200, type ? { 'content-type': type } : {});
      res.write('private invalid upstream content');
      // Deliberately leave the body open. The proxy must cancel it.
    }), t);
    const router = setup([provider('a', upstream)]);
    const base = await listen(createServer(router), t);
    const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request()) });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'invalid_upstream');
    await closed;
    assert.equal(router.health.get('a/test-model').inFlight, 0);
  }
});

test('packs reject secrets, unknown fields, unsafe URLs and duplicate models', () => {
  const pack = () => ({ version: 1, name: 'test', providers: [provider('a')] });
  assert.equal(validatePack(pack()).name, 'test');
  for (const edit of [p => { p.providers[0].apiKey = 'secret'; }, p => { p.providers[0].baseUrl = 'https://key:secret@example.com'; }, p => { p.providers[0].baseUrl = 'http://remote.example/v1'; }, p => { p.providers[0].models.push(model()); }]) {
    const value = pack(); edit(value); assert.throws(() => validatePack(value));
  }
});

test('CLI journey: init, repeat-safe init, credentials, import, export, doctor, Hub config', async t => {
  const home = await mkdtemp(join(tmpdir(), 'freegas-test-')); t.after(() => rm(home, { recursive: true, force: true }));
  const cli = (...args) => execFileSync(process.execPath, [resolve('bin/freegas.js'), ...args, '--home', home], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(cli('init'), /Station built/);
  assert.throws(() => cli('init'), /Already exists/);
  const creds = join(home, 'input-creds.json'); await writeFile(creds, JSON.stringify({ CUSTOM_KEY: 'secret-fixture-value' }));
  cli('credentials', creds);
  const custom = join(home, 'custom.json');
  await writeFile(custom, JSON.stringify({ version: 1, name: 'research', providers: [provider('custom', undefined, { keyEnv: 'CUSTOM_KEY', models: [model({ tasks: ['research'] })] })] }));
  cli('import', custom);
  const exported = cli('export', 'research'); assert.doesNotMatch(exported, /secret-fixture-value/); assert.match(exported, /CUSTOM_KEY/);
  assert.match(cli('doctor'), /custom.*configured/);
  cli('hub'); const hub = JSON.parse(await readFile(join(home, 'hub.yaml'), 'utf8'));
  assert.equal(hub.general.trace_content_enabled, false); assert.equal(hub.providers[0].base_url, 'http://127.0.0.1:4040/v1');
  assert.ok(hub.models.some(m => m.key === 'freegas/research'));
});
