import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';

const valid = () => ({ model: 'freegas/code', messages: [{ role: 'user', content: 'hello' }] });
async function start(t, route) {
  const server = createServer({ providers: [], route });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, send: (value, headers = {}) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) }) };
}

test('malformed request shapes fail before reaching any provider', async t => {
  let calls = 0; const { send } = await start(t, () => { calls++; throw new Error('must not route'); });
  const cases = [null, [], {}, { ...valid(), messages: [] }, { ...valid(), messages: [null] }, { ...valid(), messages: [{}] },
    { ...valid(), model: 1 }, { ...valid(), stream: 'true' }, { ...valid(), max_tokens: 0 }, { ...valid(), max_completion_tokens: 1.5 },
    { ...valid(), tools: {} }, { ...valid(), response_format: null }, { ...valid(), response_format: { type: 'yaml' } },
    { ...valid(), messages: [{ role: 'user', content: 3 }] }, { ...valid(), messages: [{ role: 'user', content: [null] }] }];
  for (const value of cases) { const response = await send(value); assert.equal(response.status, 400); assert.equal((await response.json()).error.type, 'freegas_error'); }
  for (const type of ['text/plain', 'application/jsonp', 'application/json-invalid']) assert.equal((await send(valid(), { 'content-type': type })).status, 415);
  assert.equal(calls, 0);
});

test('media types allow charset and case variations but reject misleading upstream types', async t => {
  let type = 'Application/JSON; charset=utf-8'; let finished = 0;
  const { send } = await start(t, async () => ({ response: new Response('{}', { headers: { 'content-type': type } }), provider: 'fixture', finish: () => finished++ }));
  assert.equal((await send(valid(), { 'content-type': 'Application/JSON; charset=utf-8' })).status, 200);
  for (const invalid of ['application/jsonp', 'text/html; example=application/json', 'text/event-stream-invalid']) {
    type = invalid; assert.equal((await send(valid())).status, 502);
  }
  assert.equal(finished, 4);
});

test('health and wrong routes are stable and internal errors withhold private details', async t => {
  const { base, send } = await start(t, () => { throw new Error('secret upstream details'); });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  const response = await send(valid()); assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await response.text(), /secret upstream/);
});

test('client disconnect cancels the accepted stream and releases it exactly once', { timeout: 5000 }, async t => {
  let signal; let finished = 0; let release;
  const done = new Promise(resolve => { release = resolve; });
  const { send } = await start(t, async (_body, requestSignal) => {
    signal = requestSignal;
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
      requestSignal.addEventListener('abort', () => controller.error(new Error('cancelled')), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
    return { response, provider: 'fixture', finish: () => { finished++; release(); } };
  });
  const response = await send({ ...valid(), stream: true });
  const reader = response.body.getReader(); await reader.read(); await reader.cancel();
  await done; assert.equal(signal.aborted, true); assert.equal(finished, 1);
});
