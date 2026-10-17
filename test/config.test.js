import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, readJson, saveJson, validateCredentials, validatePack, MAX_FILE } from '../src/config.js';

const pack = () => ({ version: 1, name: 'test', providers: [{ id: 'local', baseUrl: 'http://127.0.0.1:1234/v1', keyEnv: 'FREEGAS_TEST_CONFIG_KEY', models: [{ id: 'model', offer: 'local', context: 10000, priority: 50, tasks: ['code'], capabilities: [] }] }] });
async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), 'freegas-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await saveJson(join(dir, 'config.json'), { version: 1, lists: ['test'], allowTrials: false, timeoutMs: 1000 });
  await saveJson(join(dir, 'lists/test.json'), pack());
  return dir;
}

test('configuration survives save/reload, optional credentials, and environment precedence', async t => {
  const dir = await home(t);
  assert.equal((await load(dir)).providers[0].id, 'local');
  await saveJson(join(dir, 'credentials.json'), { FREEGAS_TEST_CONFIG_KEY: 'imported', FREEGAS_TEST_OTHER_KEY: 'retained' });
  const previous = process.env.FREEGAS_TEST_CONFIG_KEY;
  t.after(() => { if (previous === undefined) delete process.env.FREEGAS_TEST_CONFIG_KEY; else process.env.FREEGAS_TEST_CONFIG_KEY = previous; });
  process.env.FREEGAS_TEST_CONFIG_KEY = 'environment';
  const loaded = await load(dir);
  assert.equal(loaded.env.FREEGAS_TEST_CONFIG_KEY, 'environment');
  assert.equal(loaded.env.FREEGAS_TEST_OTHER_KEY, 'retained');
  assert.equal(loaded.config.allowTrials, false);
  if (process.platform !== 'win32') assert.equal((await stat(join(dir, 'credentials.json'))).mode & 0o777, 0o600);
});

test('exclusive writes preserve existing data and normal saves replace valid JSON', async t => {
  const dir = await home(t); const path = join(dir, 'credentials.json');
  await saveJson(path, { KEY: 'first' }, true);
  await assert.rejects(saveJson(path, { KEY: 'second' }, true), { code: 'EEXIST' });
  assert.deepEqual(await readJson(path), { KEY: 'first' });
  await saveJson(path, { KEY: 'second' });
  assert.deepEqual(await readJson(path), { KEY: 'second' });
});

test('invalid, oversized, and corrupt credential files fail closed', async t => {
  const dir = await home(t); const path = join(dir, 'credentials.json');
  for (const value of ['{', ' '.repeat(MAX_FILE + 1), '{"KEY":"secret\\nline"}', '[]', 'null']) {
    await writeFile(path, value);
    await assert.rejects(load(dir));
  }
  assert.match(await readFile(path, 'utf8'), /null/);
});

test('credentials reject invalid names and values without accepting inline multiline secrets', () => {
  for (const value of [null, [], 'key', { lower: 'key' }, { KEY: '' }, { KEY: 42 }, { KEY: 'x\ny' }, { KEY: 'x\ry' }, { KEY: 'x'.repeat(4097) }]) assert.throws(() => validateCredentials(value));
  assert.deepEqual(validateCredentials({ KEY_1: 'fixture' }), { KEY_1: 'fixture' });
});

test('packs reject malformed and out-of-bound community lists', () => {
  const edits = [
    p => { p.version = 2; }, p => { p.providers = []; }, p => { p.providers.push(structuredClone(p.providers[0])); },
    p => { p.providers[0].id = '../escape'; }, p => { p.providers[0].keyEnv = 'bad-key'; },
    p => { p.providers[0].baseUrl = 'https://example.org/v1?key=secret'; },
    p => { p.providers[0].baseUrl = 'https://example.org/#secret'; },
    p => { p.providers[0].models = []; }, p => { p.providers[0].models[0].context = 0; },
    p => { p.providers[0].models[0].priority = 101; }, p => { p.providers[0].models[0].offer = 'paid'; },
    p => { p.providers[0].models[0].tasks = ['../code']; }, p => { p.providers[0].models[0].capabilities = ['telepathy']; },
    p => { p.providers[0].models[0].id = 'bad\nmodel'; }, p => { p.providers[0].models[0].secret = 'nope'; },
  ];
  for (const edit of edits) { const value = pack(); edit(value); assert.throws(() => validatePack(value)); }
  for (const url of ['http://localhost:1234/v1', 'http://[::1]:1234/v1', 'https://example.org/v1']) {
    const value = pack(); value.providers[0].baseUrl = url; assert.equal(validatePack(value), value);
  }
});

test('load rejects traversal, invalid options, missing lists, and providers duplicated across lists', async t => {
  const dir = await home(t); const path = join(dir, 'config.json');
  const valid = await readJson(path);
  for (const changes of [{ lists: ['../escape'] }, { lists: [] }, { version: 2 }, { timeoutMs: 99 }, { timeoutMs: 300001 }, { allowTrials: 'yes' }, { surprise: true }, { lists: ['missing'] }]) {
    await saveJson(path, { ...valid, ...changes }); await assert.rejects(load(dir));
  }
  await saveJson(join(dir, 'lists/another.json'), pack());
  await saveJson(path, { ...valid, lists: ['test', 'another'] });
  await assert.rejects(load(dir), /Duplicate provider local/);
});
