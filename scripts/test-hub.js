import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve('.');
const live = process.argv.includes('--live');
const hubBin = resolve(process.env.HUB_BIN ?? `.integration/hub/target/debug/hub${process.platform === 'win32' ? '.exe' : ''}`);
const home = await mkdtemp(join(tmpdir(), 'freegas-hub-'));
const children = [];
const servers = [];
let logs = '';
const report = { mode: live ? 'live' : 'mock-provider', hubRevision: 'e1be468f87de077ce066fbdebc858e913dc889a1', checks: [] };
const token = 'freegas-integration-local-token';
const env = { ...process.env, FREEGAS_API_KEY: token, TRACE_CONTENT_ENABLED: 'false', HUB_MODE: 'yaml', RUST_LOG: 'warn' };
function launch(file, args, extra = {}, options = {}) {
  const child = spawn(file, args, { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options });
  children.push(child);
  child.on('error', error => { logs += `spawn failed: ${error.code}\n`; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk.toString()).slice(-20000); });
  return child;
}
async function port() {
  const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(r => server.close(r)); return value;
}
async function ready(base, child) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null || child.signalCode) throw new Error(`Service exited before readiness: ${logs}`);
    try { const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Service readiness timeout: ${logs}`);
}
const tool = { type: 'function', function: { name: 'write_smoke_file', description: 'Write the smoke result file.', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false } } };
const completion = message => ({ id: 'chatcmpl-smoke', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
let quotaCalls = 0;
let providerCalls = 0;
const stationRequests = [];
try {
  await mkdir(join(home, 'lists'));
  let providers;
  if (live) {
    assert.ok(process.env.VENICE_API_KEY, 'Set VENICE_API_KEY for the opt-in live test.');
    providers = [{ id: 'venice-smoke', baseUrl: 'https://api.venice.ai/api/v1', keyEnv: 'VENICE_API_KEY', models: [{ id: process.env.FREEGAS_LIVE_MODEL ?? 'qwen3-coder-480b-a35b-instruct-turbo', tasks: ['code'], capabilities: ['tools'], context: 200000, priority: 50, offer: 'trial' }] }];
  } else {
    const station = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      stationRequests.push({ path: req.url, model: body.model });
      if (req.url.startsWith('/dry/')) { quotaCalls++; res.writeHead(429, { 'retry-after': '60' }); res.end(); return; }
      providerCalls++;
      const hasResult = body.messages.some(m => m.role === 'tool');
      const reply = req.url.startsWith('/research/') ? 'RESEARCH_ONLY' : req.url.startsWith('/chat/') ? 'CHAT_ONLY' : 'FREEGAS_OK';
      const message = body.tools?.length && !hasResult ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_smoke', type: 'function', function: { name: 'write_smoke_file', arguments: JSON.stringify({ content: 'FREEGAS_OK' }) } }] } : { role: 'assistant', content: reply };
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const delta = { ...message }; delete delta.role;
        if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map(c => ({ ...c, index: 0 }));
        res.write(`data: ${JSON.stringify({ id: 'chatcmpl-smoke', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.end(`data: ${JSON.stringify({ id: 'chatcmpl-smoke', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
      } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(completion(message))); }
    });
    station.listen(0, '127.0.0.1'); await once(station, 'listening'); servers.push(station);
    const base = `http://127.0.0.1:${station.address().port}`;
    providers = ['dry', 'working'].map((name, index) => ({ id: name, baseUrl: `${base}/${name}`, models: [{ id: 'fixture', tasks: ['code'], capabilities: ['tools'], context: 32000, priority: 80 - index * 20, offer: 'local' }] }));
    for (const [task, priority] of [['research', 100], ['chat', 90]]) providers.push({ id: task, baseUrl: `${base}/${task}`, models: [{ id: `${task}-fixture`, tasks: [task], capabilities: ['tools'], context: 32000, priority, offer: 'local' }] });
  }
  await writeFile(join(home, 'config.json'), JSON.stringify({ version: 1, lists: ['smoke'], allowTrials: live, timeoutMs: 60000 }));
  await writeFile(join(home, 'lists/smoke.json'), JSON.stringify({ version: 1, name: 'Integration smoke Pre-roll', providers }));
  execFileSync(process.execPath, [join(root, 'bin/freegas.js'), 'hub', '--home', home], { env });
  const freegasPort = await port(); const hubPort = await port();
  const configPath = join(home, 'hub.yaml'); const hubConfig = JSON.parse(await readFile(configPath, 'utf8'));
  hubConfig.providers[0].base_url = `http://127.0.0.1:${freegasPort}/v1`;
  await writeFile(configPath, JSON.stringify(hubConfig));
  const freegas = launch(process.execPath, [join(root, 'bin/freegas.js'), 'serve', '--quiet', '--port', String(freegasPort), '--home', home]);
  const hub = launch(hubBin, [], { CONFIG_FILE_PATH: configPath, PORT: String(hubPort) });
  const hubBase = `http://127.0.0.1:${hubPort}`;
  await ready(`http://127.0.0.1:${freegasPort}`, freegas); await ready(hubBase, hub);
  async function chat(body) {
    const response = await fetch(`${hubBase}/api/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ model: 'freegas/code', max_tokens: 256, ...body }), signal: AbortSignal.timeout(90000) });
    assert.equal(response.status, 200, `Hub request failed (${response.status}): ${await response.clone().text()}`);
    return response;
  }
  const messages = [{ role: 'user', content: 'Use write_smoke_file to write exactly FREEGAS_OK. Then confirm completion briefly.' }];
  const result = await (await chat({ messages, tools: [tool], tool_choice: { type: 'function', function: { name: 'write_smoke_file' } } })).json();
  const assistant = result.choices[0].message;
  const call = assistant.tool_calls?.[0]; assert.equal(call?.function.name, 'write_smoke_file');
  const { content } = JSON.parse(call.function.arguments); assert.equal(content, 'FREEGAS_OK');
  await writeFile(join(home, 'result.txt'), content);
  messages.push(assistant, { role: 'tool', tool_call_id: call.id, content: 'File written successfully.' });
  const final = await (await chat({ messages })).json(); assert.ok(final.choices[0].message.content);
  assert.equal(await readFile(join(home, 'result.txt'), 'utf8'), 'FREEGAS_OK');
  report.checks.push('nonstream tool round trip and real file side effect');
  if (!live) {
    assert.equal(quotaCalls, 1); assert.equal(providerCalls, 2);
    assert.ok(stationRequests.every(r => r.path.startsWith('/dry/') || r.path.startsWith('/working/')), 'Code requests escaped their task stations.');
    report.checks.push('429 fallback and cooldown through actual Hub');
    for (const [alias, station, content] of [['code', 'working', 'FREEGAS_OK'], ['chat', 'chat', 'CHAT_ONLY'], ['research', 'research', 'RESEARCH_ONLY'], ['auto', 'research', 'RESEARCH_ONLY']]) {
      const result = await (await chat({ model: `freegas/${alias}`, messages: [{ role: 'user', content: 'Task isolation probe.' }] })).json();
      assert.equal(result.choices[0].message.content, content, `${alias} reached the wrong station.`);
      assert.ok(stationRequests.at(-1).path.startsWith(`/${station}/`));
      assert.equal(stationRequests.at(-1).model, ['research', 'chat'].includes(station) ? `${station}-fixture` : 'fixture');
    }
    const beforeUnknown = stationRequests.length;
    const unknown = await fetch(`${hubBase}/api/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'freegas/unknown', messages: [{ role: 'user', content: 'Reject unknown alias.' }] }) });
    assert.equal(unknown.status, 404); assert.equal(stationRequests.length, beforeUnknown);
    report.checks.push('code/chat/research aliases stay isolated; auto selects the higher-priority research station; unknown alias rejected');
  }
  const stream = await (await chat({ messages: [{ role: 'user', content: 'Reply exactly FREEGAS_OK.' }], stream: true })).text();
  assert.match(stream, /FREEGAS_OK/, `Stream lost its content: ${stream}`);
  report.checks.push('streamed text through actual Hub');
  assert.ok(!logs.includes('Use write_smoke_file to write exactly'), 'Prompt leaked into process logs.');
  report.checks.push('prompt absent from captured service logs');
  if (process.argv.includes('--opencode')) {
    assert.ok(live, 'The named OpenCode harness check requires --live.');
    const work = join(home, 'harness'); await mkdir(work);
    const opencodeConfig = join(home, 'opencode.json');
    await writeFile(opencodeConfig, JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      enabled_providers: ['freegas'], model: 'freegas/freegas/code', small_model: 'freegas/freegas/code',
      permission: { '*': 'deny', read: 'allow', edit: 'allow', external_directory: 'deny' },
      provider: { freegas: { npm: '@ai-sdk/openai-compatible', name: 'Freegas', options: { baseURL: `${hubBase}/api/v1`, apiKey: token }, models: { 'freegas/code': { name: 'Freegas coding pump', limit: { context: 200000, output: 2048 } } } } },
    }));
    const opencodeBin = resolve(process.env.OPENCODE_BIN ?? `.integration/opencode/node_modules/opencode-ai/bin/opencode${process.platform === 'win32' ? '.exe' : ''}`);
    const scrubbedKeys = Object.fromEntries(Object.keys(env).filter(k => /API_KEY|AUTH_TOKEN/.test(k)).map(k => [k, undefined]));
    const harness = launch(opencodeBin, ['run', '--pure', '--format', 'json', '--title', 'Freegas integration smoke', '--model', 'freegas/freegas/code', 'Create answer.txt in the current directory containing exactly FREEGAS_HARNESS_OK followed by a newline. Use the file-writing tool, do not use a shell, then stop.'], {
      ...scrubbedKeys, OPENCODE_CONFIG: opencodeConfig, OPENCODE_CONFIG_DIR: join(home, 'opencode-config'),
      XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_DATA_HOME: join(home, 'xdg-data'), XDG_CACHE_HOME: join(home, 'xdg-cache'), XDG_STATE_HOME: join(home, 'xdg-state'),
    }, { cwd: work });
    const deadline = setTimeout(() => harness.kill(), 120000);
    let output = ''; harness.stdout.on('data', chunk => { output += chunk; }); harness.stderr.on('data', chunk => { output += chunk; });
    try {
      const [code] = await once(harness, 'exit');
      if (code !== 0) throw new Error(`OpenCode exited ${code}: ${output.slice(-4000)}`);
      await mkdir(resolve('.integration'), { recursive: true });
      await writeFile(resolve('.integration/opencode-smoke.log'), output);
      assert.equal((await readFile(join(work, 'answer.txt'), 'utf8')).trim(), 'FREEGAS_HARNESS_OK');
      const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      assert.ok(events.some(event => event.type === 'tool_use' && ['write', 'edit', 'apply_patch'].includes(event.part?.tool) && event.part?.state?.status === 'completed'), 'No completed file-writing tool event.');
      report.checks.push('OpenCode 1.19.3 live streamed coding session wrote verified answer.txt');
    } finally { clearTimeout(deadline); }
  }
  await mkdir(resolve('.integration'), { recursive: true });
  await writeFile(resolve(`.integration/${live ? 'live' : 'hub'}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const child of children) {
    if (child.pid && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit').catch(() => {}); child.kill(); await exited; }
  }
  for (const server of servers) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  await rm(home, { recursive: true, force: true });
}
