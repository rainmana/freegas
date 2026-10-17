import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cliPath = resolve('bin/freegas.js');
// A subprocess receives only what the test needs, never the developer's inference credentials.
const env = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|FREEGAS_HOME|NODE_OPTIONS/i.test(key)));
async function run(home, args, expected = 0) {
  const child = spawn(process.execPath, [cliPath, ...args, '--home', home, '--no-open'], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const [code] = await once(child, 'exit'); assert.equal(code, expected, output); return output;
}
async function temp(t) {
  const home = await mkdtemp(join(tmpdir(), 'freegas-user-')); t.after(() => rm(home, { recursive: true, force: true })); return home;
}

test('user mistakes fail cleanly without overwriting installed lists or credentials', { timeout: 20000 }, async t => {
  const home = await temp(t);
  assert.match(await run(home, ['--help']), /Ass, gas, or grass - nobody rides for free\./);
  for (const args of [['wrong'], ['credentials'], ['import'], ['export', '../credentials'], ['init', 'extra'], ['--unknown']]) assert.match(await run(home, args, 1), /FREEGAS:/);
  await run(home, ['init']);
  const original = await readFile(join(home, 'lists/starter.json'), 'utf8');
  assert.match(await run(home, ['init'], 1), /Already exists/);
  const input = join(home, 'input.json'); await writeFile(input, original);
  assert.match(await run(home, ['import', input], 1), /already installed/);
  assert.equal(await readFile(join(home, 'lists/starter.json'), 'utf8'), original);
  await writeFile(input, JSON.stringify({ TEST_FIRST: 'fixture-first' })); await run(home, ['credentials', input]);
  await writeFile(input, JSON.stringify({ TEST_SECOND: 'fixture-second' })); await run(home, ['credentials', input]);
  const credentials = await readFile(join(home, 'credentials.json'), 'utf8');
  await writeFile(input, JSON.stringify({ TEST_FIRST: 'invalid\nkey' })); await run(home, ['credentials', input], 1);
  assert.equal(await readFile(join(home, 'credentials.json'), 'utf8'), credentials);
  assert.deepEqual(JSON.parse(credentials), { TEST_FIRST: 'fixture-first', TEST_SECOND: 'fixture-second' });
  for (const port of ['0', '65536', 'nope', '1.5']) assert.match(await run(home, ['serve', '--port', port], 1), /Port must/);
});

test('real CLI road trip: share a list, authenticate, fail over, use a tool, stream, and shut down', { timeout: 20000 }, async t => {
  const home = await temp(t);
  const command = args => run(home, args);
  const received = []; let dryCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    if (req.url.startsWith('/dry/')) { dryCalls++; res.writeHead(429, { 'retry-after': '60' }); res.end('private quota details'); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); received.push({ body, authorization: req.headers.authorization });
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from('data: {"choices":[{"delta":{"content":"Fuel acquired ⛽"}}]}\n\ndata: [DONE]\n\n');
      // Split UTF-8 and SSE records across transport chunks.
      for (const byte of bytes) res.write(Buffer.from([byte])); res.end(); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: body.messages.at(-1).role === 'tool' ? { role: 'assistant', content: 'FREEGAS_OK' } : { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{"content":"FREEGAS_OK"}' } }] } }] }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  await command(['init']);
  const model = priority => ({ id: 'fixture-coder', offer: 'local', priority, context: 32000, tasks: ['code'], capabilities: ['tools'] });
  const pack = { version: 1, name: 'Road trip', providers: [
    { id: 'dry', baseUrl: `${upstreamUrl}/dry`, models: [model(90)] },
    { id: 'working', baseUrl: `${upstreamUrl}/working`, keyEnv: 'ROAD_TRIP_KEY', models: [model(80)] },
  ] };
  const list = join(home, 'road-trip.json'); await writeFile(list, JSON.stringify(pack)); await command(['import', list]);
  const keys = join(home, 'keys.json'); await writeFile(keys, '{"ROAD_TRIP_KEY":"fixture-provider-secret"}'); await command(['credentials', keys]);
  const exported = await run(home, ['export', 'road-trip']); assert.deepEqual(JSON.parse(exported), pack); assert.doesNotMatch(exported, /fixture-provider-secret/);
  // A second installation really consumes the exported community list.
  const secondHome = await temp(t); await run(secondHome, ['init']);
  const shared = join(secondHome, 'shared.json'); await writeFile(shared, exported); await run(secondHome, ['import', shared]);
  assert.match(await run(secondHome, ['doctor']), /working.*parked/);
  await writeFile(join(home, 'config.json'), JSON.stringify({ version: 1, lists: ['road-trip'], timeoutMs: 2000, allowTrials: false }));
  await command(['doctor']);
  // Reserve an ephemeral port, then release immediately before launching the real process.
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [cliPath, 'serve', '--no-open', '--home', home, '--port', String(port)], { env: { ...env(), FREEGAS_API_KEY: 'fixture-local-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let logs = '';
  t.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } });
  const ready = new Promise((resolveReady, reject) => {
    child.stderr.on('data', chunk => { logs += chunk; if (logs.includes('Ctrl+C closes')) resolveReady(); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`CLI exited before ready: ${code}: ${logs}`)));
  });
  await ready;
  const base = `http://127.0.0.1:${port}`;
  assert.match(await (await fetch(base)).text(), /The forecourt/);
  for (const path of ['/dashboard.js', '/dashboard.css', '/icon.png']) assert.equal((await fetch(base + path)).status, 200);
  assert.equal((await fetch(base + '/api/status')).status, 401);
  const status = () => fetch(base + '/api/status', { headers: { authorization: 'Bearer fixture-local-token' } }).then(r => r.json());
  assert.equal((await status()).totals.requests, 0);
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  const send = (body, token = 'fixture-local-token') => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const messages = [{ role: 'user', content: 'private-user-prompt' }];
  const request = { model: 'freegas/code', messages, tools: [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }] };
  assert.equal((await send(request, 'wrong')).status, 401); assert.equal(dryCalls, 0);
  const first = await send(request); assert.equal(first.status, 200); assert.equal(first.headers.get('x-freegas-provider'), 'working');
  const assistant = (await first.json()).choices[0].message;
  const args = JSON.parse(assistant.tool_calls[0].function.arguments);
  const artifact = join(home, 'answer.txt'); await writeFile(artifact, args.content);
  messages.push(assistant, { role: 'tool', tool_call_id: 'call_1', content: 'File written' });
  const final = await send(request); const content = (await final.json()).choices[0].message.content;
  assert.equal(content, 'FREEGAS_OK'); assert.equal(await readFile(artifact, 'utf8'), content);
  const stream = await send({ model: 'freegas/code', messages: [{ role: 'user', content: 'stream' }], stream: true });
  assert.equal(stream.status, 200); const text = await stream.text(); assert.match(text, /Fuel acquired ⛽/); assert.match(text, /data: \[DONE\]/);
  const dashboard = await status();
  assert.equal(dashboard.totals.requests, 3); assert.equal(dashboard.totals.completed, 3); assert.equal(dashboard.totals.fallbacks, 1);
  assert.equal(dashboard.stations.find(s => s.provider === 'dry').status, 'cooldown');
  assert.equal(dashboard.stations.find(s => s.provider === 'working').status, 'observed_success');
  assert.ok(dashboard.activity.some(event => event.type === 'fallback'));
  assert.doesNotMatch(JSON.stringify(dashboard), /fixture-provider-secret|fixture-local-token|private-user-prompt|private quota details|FREEGAS_OK/);
  assert.equal(dryCalls, 1); assert.equal(received.length, 3);
  assert.ok(received.every(r => r.authorization === 'Bearer fixture-provider-secret' && r.body.model === 'fixture-coder'));
  // A second process cannot bind the same station, and must exit cleanly with a useful message.
  assert.match(await run(home, ['serve', '--port', String(port)], 1), /EADDRINUSE/);
  child.kill('SIGTERM'); const [code, signal] = await exited;
  if (process.platform !== 'win32') { assert.equal(code, 0); assert.equal(signal, null); }
  else assert.ok(code !== null || signal !== null);
  assert.doesNotMatch(logs, /fixture-provider-secret|fixture-local-token|private-user-prompt|private quota details/);
});
