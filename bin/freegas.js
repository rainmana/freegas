#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { load, readJson, saveJson, validatePack, validateCredentials, MAX_FILE } from '../src/config.js';
import { FuelRouter } from '../src/router.js';
import { createServer } from '../src/server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `FREEGAS — Ass, gas, or grass - nobody rides for free.
Your coding agent has selected: promotional fuel vouchers.

  freegas init                      Unpack the starter Pre-roll
  freegas list                      Show pumps and credential readiness
  freegas doctor                    Check local setup (no inference calls)
  freegas stations                  Tour your configured Gas Stations
  freegas import FILE_OR_HTTPS_URL   Validate and install a Pre-roll
  freegas export NAME               Pass a Pre-roll, without passing your keys
  freegas credentials FILE          Import {"ENV_NAME":"secret"} locally
  freegas hub                       Generate Traceloop Hub config
  freegas serve                     Open the station on 127.0.0.1:4040

Options: --home DIR (default .freegas), --port N, --quiet, --help
For local Hub: set FREEGAS_API_KEY in both processes for access control.
Environment credentials override locally imported credentials.
No card tricks. No account juggling. Just the free tier you already have.`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { home: { type: 'string' }, port: { type: 'string' }, quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command, arg, ...extra] = positionals;
  if (values.help || !command) { console.log(help); return; }
  if (!['init', 'list', 'stations', 'doctor', 'import', 'export', 'credentials', 'hub', 'serve'].includes(command)) throw new Error(`Unknown command: ${command}. The pump is confused. Try freegas --help.`);
  if (extra.length || (arg && !['import', 'export', 'credentials'].includes(command))) throw new Error('Unexpected argument. Try freegas --help.');
  const home = resolve(values.home ?? process.env.FREEGAS_HOME ?? '.freegas');
  if (command === 'init') {
    const starter = validatePack(JSON.parse(await readFile(resolve(root, 'lists/starter.json'), 'utf8')));
    await mkdir(resolve(home, 'lists'), { recursive: true });
    await saveJson(resolve(home, 'lists/starter.json'), starter, true);
    await saveJson(resolve(home, 'config.json'), { version: 1, lists: ['starter'], allowTrials: false, timeoutMs: 60000 }, true);
    console.log(`Gas Station built at ${home}. Ass, gas, or grass - nobody rides for free.\nFortunately, somebody left some promotional fuel vouchers.\nSet GROQ_API_KEY and/or OPENROUTER_API_KEY, then run freegas serve. Run freegas hub to put Traceloop Hub in the driver's seat.`); return;
  }
  if (command === 'credentials') {
    if (!arg) throw new Error('Provide a credentials JSON file. Please do not paste keys into command arguments.');
    const imported = validateCredentials(await readJson(resolve(arg)));
    let existing = {};
    try { existing = validateCredentials(await readJson(resolve(home, 'credentials.json'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await saveJson(resolve(home, 'credentials.json'), { ...existing, ...imported });
    console.log('Keys parked locally. Pre-rolls are for sharing; credentials are not.'); return;
  }
  if (command === 'import') {
    if (!arg) throw new Error('Bring a Pre-roll: provide a provider-list JSON file or HTTPS URL.');
    let pack;
    if (/^https:\/\//.test(arg)) {
      const url = new URL(arg);
      if (url.username || url.password || url.search || url.hash) throw new Error('List URL must not contain credentials, queries, or fragments.');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`List download failed (${response.status}).`);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > MAX_FILE) { await response.body.cancel().catch(() => {}); throw new Error('List exceeds 1 MB.'); } chunks.push(chunk); }
      try { pack = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error('Expected a Pre-roll JSON document. A Markdown directory is a map, not gasoline. See docs/lists.md.'); }
    } else pack = await readJson(resolve(arg));
    validatePack(pack);
    const loaded = await load(home);
    const name = pack.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
    if (!name) throw new Error('List name needs at least one ASCII letter or number.');
    for (const p of pack.providers) if (loaded.providers.some(other => other.id === p.id)) throw new Error(`Provider ${p.id} is already installed. Edit or remove its current list first.`);
    await saveJson(resolve(home, 'lists', `${name}.json`), pack, true);
    loaded.config.lists.push(name);
    await saveJson(resolve(home, 'config.json'), loaded.config);
    console.log(`Installed ${name}. Imported endpoints receive prompts when selected. Inspect with freegas list.`); return;
  }
  if (command === 'export') {
    if (!arg || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(arg)) throw new Error('Provide a list name from config.json.');
    console.log(JSON.stringify(validatePack(await readJson(resolve(home, 'lists', `${arg}.json`))), null, 2)); return;
  }
  const loaded = await load(home);
  if (command === 'list' || command === 'stations' || command === 'doctor') {
    console.log('GAS STATIONS — a road trip funded by the complimentary samples aisle.');
    let ready = 0;
    for (const p of loaded.providers) {
      const keyed = !p.keyEnv || Boolean(loaded.env[p.keyEnv]);
      for (const m of p.models) {
        const enabled = keyed && (m.offer !== 'trial' || loaded.config.allowTrials);
        if (enabled) ready++;
        console.log(`${p.id} / ${m.id}: ${enabled ? 'configured' : 'parked'} | ${m.offer} | ${m.tasks.join(',')} | ${p.baseUrl}${!keyed ? ` | missing ${p.keyEnv}` : ''}`);
      }
    }
    console.log(`${ready} configured pump(s). Availability and free quota are unverified. No requests spent in the making of this diagnosis.`);
    if (command === 'doctor' && !ready) process.exitCode = 1;
    return;
  }
  if (command === 'hub') {
    const tasks = [...new Set(['auto', ...loaded.providers.flatMap(p => p.models.flatMap(m => m.tasks))])];
    const modelKeys = tasks.map(t => `freegas/${t}`);
    const config = { general: { trace_content_enabled: false }, providers: [{ key: 'freegas', type: 'openai', api_key: process.env.FREEGAS_API_KEY ? '${FREEGAS_API_KEY}' : 'freegas-local', base_url: 'http://127.0.0.1:4040/v1' }], models: modelKeys.map(key => ({ key, type: key, provider: 'freegas' })), pipelines: [{ name: 'default', type: 'chat', plugins: [{ 'model-router': { models: modelKeys } }] }] };
    // JSON is a YAML subset; no YAML dependency or interpolation of secrets required.
    await mkdir(home, { recursive: true });
    await writeFile(resolve(home, 'hub.yaml'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    console.log(`Hub config: ${resolve(home, 'hub.yaml')}\nRun freegas serve on port 4040, then start a local Hub binary with CONFIG_FILE_PATH pointing to this file.\nSet TRACE_CONTENT_ENABLED=false in Hub's environment; the tested Hub ignores that YAML setting.\nHarness base URL: http://127.0.0.1:3000/api/v1\nSee docs/hub.md for Docker networking and verification limits.`); return;
  }
  if (command === 'serve') {
    const port = Number(values.port ?? 4040);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535. That is the entire pump aisle.');
    const router = new FuelRouter(loaded, { log: values.quiet ? () => {} : message => console.error(message) });
    const server = createServer(router, { token: process.env.FREEGAS_API_KEY });
    server.requestTimeout = 30000;
    server.on('error', error => { console.error(`Station closed: ${error.code ?? 'listen failed'}. Try another --port.`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.error(`FREEGAS: http://127.0.0.1:${port}/v1\nYour tokens are on a scholarship. Ctrl+C closes the station.`));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); server.closeAllConnections(); });
    return;
  }
  throw new Error(`Unknown command: ${command}. The pump is confused. Try freegas --help.`);
}
main().catch(error => { console.error(`FREEGAS: ${error.code === 'EEXIST' ? 'Already exists. No bulldozers at this station; keep or rename the existing file.' : error.code === 'ENOENT' ? 'Missing setup or input file. Run freegas init, or check the path.' : error.message}`); process.exitCode = 1; });
