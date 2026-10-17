import test from 'node:test';
import assert from 'node:assert/strict';
import { FuelRouter } from '../src/router.js';

const body = (extra = {}) => ({ model: 'freegas/code', messages: [{ role: 'user', content: 'hello' }], ...extra });
const provider = (id, capabilities = ['tools', 'json', 'json_schema', 'vision']) => ({ id, baseUrl: 'https://example.org/v1', models: [{ id: 'model', tasks: ['code'], capabilities, context: 32000, priority: 50, offer: 'free' }] });
const router = (providers, fetchImpl, now = Date.now) => new FuelRouter({ providers, config: { timeoutMs: 1000, allowTrials: false }, env: {} }, { fetchImpl, now });

test('Retry-After seconds, dates, nonsense and extreme values recover at bounded deadlines', async t => {
  const time = Date.parse('2026-10-17T12:00:00Z');
  for (const [header, delay] of [['2', 2000], ['0', 1000], ['-10', 1000], ['999999999', 86400000], ['nonsense', 30000], [new Date(time + 5000).toUTCString(), 5000]]) {
    await t.test(header, async () => {
      let now = time; let calls = 0;
      const r = router([provider('a')], async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': header } }) : new Response('{}'), () => now);
      await assert.rejects(r.route(body()), { code: 'all_pumps_busy' });
      now = time + delay - 1;
      await assert.rejects(r.route(body()), { code: 'empty_tank' });
      assert.equal(calls, 1);
      now++;
      const result = await r.route(body()); result.finish(); result.finish();
      assert.equal(calls, 2); assert.equal(r.health.get('a/model').failures, 0); assert.equal(r.health.get('a/model').inFlight, 0);
    });
  }
});

test('auth and missing-model cooldowns override shorter upstream retry hints', async () => {
  for (const status of [401, 402, 403, 404]) {
    const r = router([provider('a')], async () => new Response('', { status, headers: { 'retry-after': '1' } }), () => 1000);
    await assert.rejects(r.route(body())); assert.equal(r.health.get('a/model').until, 301000);
  }
});

test('JSON schema, image and tool history requirements cannot silently downgrade', () => {
  const r = router([provider('plain', []), provider('json', ['json']), provider('full')]);
  const ids = extra => r.candidates(body(extra)).map(row => row.p.id);
  assert.deepEqual(ids({ response_format: { type: 'json_schema', json_schema: { name: 'test', schema: {} } } }), ['full']);
  assert.deepEqual(ids({ response_format: { type: 'json_object' } }), ['full', 'json']);
  assert.deepEqual(ids({ messages: [{ role: 'tool', content: 'result' }] }), ['full']);
  assert.deepEqual(ids({ messages: [{ role: 'assistant', content: null, tool_calls: [{}] }] }), ['full']);
  assert.deepEqual(ids({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.org/image' } }] }] }), ['full']);
  assert.throws(() => ids({ messages: [{ role: 'user', content: [{ type: 'audio' }] }] }), { code: 'unsupported_content' });
});

test('trial opt-in and auto alias work while output reserves exclude small contexts', () => {
  const p = provider('trial'); p.models[0].offer = 'trial';
  const r = router([p]); assert.equal(r.candidates(body()).length, 0);
  r.config.allowTrials = true;
  assert.equal(r.candidates(body({ model: 'freegas/auto' })).length, 1);
  assert.equal(r.candidates(body({ max_completion_tokens: 32000 })).length, 0);
  assert.equal(r.candidates(body({ max_tokens: 32000 })).length, 0);
});

test('concurrent requests prefer an idle station and finish is idempotent', async () => {
  const r = router([provider('a'), provider('b')], async () => new Response('{}'));
  const first = await r.route(body()); const second = await r.route(body());
  assert.equal(first.provider, 'a'); assert.equal(second.provider, 'b');
  first.finish(); first.finish(); second.finish();
  assert.equal(r.health.get('a/model').inFlight, 0); assert.equal(r.health.get('b/model').inFlight, 0);
});

test('client cancellation before and during fetch never falls back or poisons health', async () => {
  let calls = 0; const controller = new AbortController();
  const r = router([provider('a'), provider('b')], async (_url, { signal }) => {
    calls++; controller.abort(); assert.equal(signal.aborted, true); throw new Error('private transport error');
  });
  await assert.rejects(r.route(body(), controller.signal), { code: 'cancelled' });
  assert.equal(calls, 1); assert.equal(r.health.get('a/model').inFlight, 0); assert.equal(r.health.get('a/model').failures, 0);
  await assert.rejects(r.route(body(), controller.signal), { code: 'cancelled' }); assert.equal(calls, 1);
});

test('transport failure falls back without leaking exception or prompt into logs', async () => {
  const logs = []; let calls = 0;
  const r = router([provider('a'), provider('b')], async () => { if (++calls === 1) throw new Error('private-key-and-prompt'); return new Response('{}'); });
  r.log = message => logs.push(message);
  const result = await r.route(body()); result.finish();
  assert.equal(result.provider, 'b'); assert.doesNotMatch(logs.join('\n'), /private-key-and-prompt|hello/);
});
