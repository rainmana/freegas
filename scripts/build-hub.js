import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const revision = 'e1be468f87de077ce066fbdebc858e913dc889a1';
const dir = resolve('.integration/hub');
await mkdir('.integration', { recursive: true });
try { await readFile(resolve(dir, 'Cargo.toml')); } catch (e) {
  if (e.code !== 'ENOENT') throw e;
  execFileSync('git', ['clone', '--no-checkout', 'https://github.com/traceloop/hub.git', dir], { stdio: 'inherit' });
  execFileSync('git', ['checkout', '--detach', revision], { cwd: dir, stdio: 'inherit' });
}
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
if (actual !== revision) throw new Error(`Expected Hub ${revision}, found ${actual}. Use a clean integration checkout.`);
const lockPath = resolve(dir, 'Cargo.lock');
const lock = await readFile(lockPath, 'utf8');
// Upstream 0.10.1 still identifies its own root package as 0.9.3 in Cargo.lock.
// Correct only that metadata; all dependency versions/checksums remain locked.
if (lock.includes('name = "hub"\nversion = "0.9.3"')) await writeFile(lockPath, lock.replace('name = "hub"\nversion = "0.9.3"', 'name = "hub"\nversion = "0.10.1"'));
else if (!lock.includes('name = "hub"\nversion = "0.10.1"')) throw new Error('Unexpected upstream Hub lockfile.');
const args = [...(process.env.HUB_RUST_TOOLCHAIN ? [`+${process.env.HUB_RUST_TOOLCHAIN}`] : []), 'build', '--locked', '--bin', 'hub', '-j', '2'];
const result = spawnSync('cargo', args, { cwd: dir, stdio: 'inherit', env: { ...process.env, CARGO_PROFILE_DEV_DEBUG: '0' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
