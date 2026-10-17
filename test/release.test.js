import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const scripts = resolve('scripts');
const sha = 'a'.repeat(40);
async function fixture(t) {
  const cwd = process.cwd();
  const home = await mkdtemp(join(tmpdir(), 'freegas-release-'));
  const saved = { ...process.env };
  process.chdir(home);
  Object.assign(process.env, { GITHUB_REPOSITORY: 'fixture/freegas', GITHUB_SHA: sha, GH_TOKEN: 'fixture-token', GITHUB_OUTPUT: join(home, 'output') });
  t.after(async () => { process.chdir(cwd); for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); await rm(home, { recursive: true, force: true }); });
  await writeFile('package.json', JSON.stringify({ version: '1.2.3' }));
  await writeFile('.release-please-manifest.json', JSON.stringify({ '.': '1.2.3' }));
  return home;
}
const execute = script => import(`${pathToFileURL(join(scripts, script)).href}?test=${randomUUID()}`);
const pr = (overrides = {}) => ({ number: 7, merged_at: '2026-10-17T00:00:00Z', merge_commit_sha: sha, base: { ref: 'main' }, head: { ref: 'release-please--branches--main' }, labels: [{ name: 'autorelease: pending' }], ...overrides });

test('release guard accepts only a version PR merged at the tested commit', async t => {
  await fixture(t);
  for (const [value, expected] of [[pr(), true], [pr({ merge_commit_sha: 'b'.repeat(40) }), false], [pr({ merged_at: null }), false], [pr({ head: { ref: 'feature/looks-like-a-release' } }), false], [pr({ base: { ref: 'other' } }), false], [pr({ labels: [] }), false], [pr({ labels: [{ name: 'autorelease: tagged' }] }), true]]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json([value]));
    await writeFile('output', ''); await execute('release-state.js');
    assert.match(await readFile('output', 'utf8'), new RegExp(`candidate=${expected}`));
    t.mock.restoreAll();
  }
});

test('release guard fails closed on API failures or a mismatched version manifest', async t => {
  await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  await assert.rejects(execute('release-state.js'), /Could not inspect/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json([pr()]));
  await writeFile('.release-please-manifest.json', JSON.stringify({ '.': '1.2.4' }));
  await assert.rejects(execute('release-state.js'), /disagrees/);
});

test('published release retries require the same commit and matching artifact digests', async t => {
  await fixture(t); await mkdir('dist');
  const file = Buffer.from('fixture archive bytes'); const hash = createHash('sha256').update(file).digest('hex');
  const checksum = `${hash}  freegas-1.2.3.tgz\n`;
  await writeFile('dist/freegas-1.2.3.tgz', file); await writeFile('dist/SHA256SUMS', checksum);
  const release = { tag_name: 'v1.2.3', draft: false, assets: [{ name: 'freegas-1.2.3.tgz', digest: `sha256:${hash}` }, { name: 'SHA256SUMS', digest: `sha256:${createHash('sha256').update(checksum).digest('hex')}` }] };
  t.mock.method(globalThis, 'fetch', async url => Response.json(url.includes('/git/ref/') ? { object: { type: 'commit', sha } } : [release]));
  await execute('finalize-release.js');
  release.assets[0].digest = 'sha256:wrong';
  await assert.rejects(execute('finalize-release.js'), /refusing to replace/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ object: { type: 'commit', sha: 'b'.repeat(40) } }));
  await assert.rejects(execute('finalize-release.js'), /tested commit/);
  await writeFile('dist/freegas-1.2.3.tgz', 'tampered');
  await assert.rejects(execute('finalize-release.js'), /checksum mismatch/);
});
