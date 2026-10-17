import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export const MAX_FILE = 1024 * 1024;
const id = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const envName = /^[A-Z][A-Z0-9_]{0,99}$/;
function check(ok, message) { if (!ok) throw new Error(message); }
function fields(obj, allowed) {
  check(obj && typeof obj === 'object' && !Array.isArray(obj), 'Expected an object. The tank takes JSON, not vibes.');
  for (const key of Object.keys(obj)) check(allowed.includes(key), `Unknown field: ${key}`);
}
export function validatePack(pack) {
  fields(pack, ['version', 'name', 'source', 'providers']);
  check(pack.version === 1 && typeof pack.name === 'string' && pack.name.length <= 120, 'Fuel list needs version: 1 and a name.');
  check(pack.source === undefined || (typeof pack.source === 'string' && pack.source.length <= 500), 'Invalid source.');
  check(Array.isArray(pack.providers) && pack.providers.length > 0 && pack.providers.length <= 100, 'List needs 1–100 providers.');
  const ids = new Set();
  for (const p of pack.providers) {
    fields(p, ['id', 'baseUrl', 'keyEnv', 'models']);
    check(typeof p.id === 'string' && id.test(p.id) && !ids.has(p.id), 'Provider IDs must be unique, simple names.'); ids.add(p.id);
    check(typeof p.baseUrl === 'string', 'Endpoint URLs must be strings. No mystery fuel containers.');
    const url = new URL(p.baseUrl);
    check(!url.username && !url.password && !url.search && !url.hash, 'Endpoint URLs cannot contain credentials, query strings, or fragments.');
    check(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'Use HTTPS, or HTTP on loopback for local inference.');
    check(p.keyEnv === undefined || (typeof p.keyEnv === 'string' && envName.test(p.keyEnv)), 'keyEnv must name an environment variable, never contain a key.');
    check(Array.isArray(p.models) && p.models.length > 0 && p.models.length <= 100, 'Each provider needs 1–100 models.');
    const models = new Set();
    for (const m of p.models) {
      fields(m, ['id', 'tasks', 'capabilities', 'context', 'priority', 'offer']);
      check(typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 200 && !/[\x00-\x1f]/.test(m.id) && !models.has(m.id), 'Invalid or duplicate model ID.'); models.add(m.id);
      check(['free', 'trial', 'local'].includes(m.offer), 'Each model needs offer: free, trial, or local.');
      check(Array.isArray(m.tasks) && m.tasks.length > 0 && m.tasks.every(t => typeof t === 'string' && id.test(t)), 'Model tasks must be simple names.');
      check(Array.isArray(m.capabilities) && m.capabilities.every(c => ['tools', 'vision', 'json', 'json_schema'].includes(c)), 'Capabilities: tools, vision, json, json_schema.');
      check(Number.isInteger(m.context) && m.context >= 1 && m.context <= 10000000, 'context must be a token count.');
      check(Number.isInteger(m.priority) && m.priority >= 0 && m.priority <= 100, 'priority must be 0–100 (higher wins).');
    }
  }
  return pack;
}
export async function readJson(path) {
  const data = await readFile(path);
  check(data.length <= MAX_FILE, 'File too large. This gas station has a one-megabyte tank.');
  try { return JSON.parse(data.toString('utf8')); } catch { throw new Error(`Invalid JSON in ${path}`); }
}
export async function saveJson(path, value, exclusive = false) {
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) return writeFile(path, content, { mode: 0o600, flag: 'wx' });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}
export function validateCredentials(value) {
  fields(value, Object.keys(value ?? {}));
  check(Object.entries(value).every(([k, v]) => envName.test(k) && typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\r\n]/.test(v)), 'Credentials must map ENV_NAMES to nonempty single-line strings.');
  return value;
}
export async function load(home) {
  const config = await readJson(resolve(home, 'config.json'));
  fields(config, ['version', 'lists', 'allowTrials', 'timeoutMs']);
  check(config.version === 1 && Array.isArray(config.lists) && config.lists.length > 0 && config.lists.length <= 100 && config.lists.every(n => typeof n === 'string' && id.test(n)), 'Invalid config lists. Run freegas init.');
  check(typeof config.allowTrials === 'boolean' && Number.isInteger(config.timeoutMs) && config.timeoutMs >= 100 && config.timeoutMs <= 300000, 'Invalid timeoutMs or allowTrials.');
  let credentials = {};
  try { credentials = validateCredentials(await readJson(resolve(home, 'credentials.json'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const env = { ...credentials, ...process.env };
  const providers = new Map();
  for (const name of config.lists) {
    const pack = validatePack(await readJson(resolve(home, 'lists', `${name}.json`)));
    for (const p of pack.providers) {
      check(!providers.has(p.id), `Duplicate provider ${p.id} across lists. Merge its models into one entry.`);
      providers.set(p.id, p);
    }
  }
  return { config, providers: [...providers.values()], env };
}
