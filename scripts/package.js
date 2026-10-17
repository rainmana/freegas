import { execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// Invoke npm through Node rather than shelling out to npm.cmd on Windows.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this with npm run package.');
await mkdir('dist', { recursive: true });
const [packed] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', 'dist'], { encoding: 'utf8' }));
for (const { path } of packed.files) {
  if (!/^(bin\/|src\/|lists\/|docs\/|assets\/|README\.md$|LICENSE$|CHANGELOG\.md$|package\.json$)/.test(path)) throw new Error(`Unexpected release file: ${path}`);
}
const archive = resolve('dist', packed.filename);
const temp = await mkdtemp(join(tmpdir(), 'freegas-package-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', temp]);
  const cli = join(temp, 'package', 'bin', 'freegas.js');
  const icon = await readFile(join(temp, 'package', 'assets', 'freegas-icon.png'));
  if (!icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Packaged README icon is missing or invalid.');
  const output = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  if (!output.includes('Ass, gas, or grass - nobody rides for free.')) throw new Error('Packaged CLI smoke failed.');
  execFileSync(process.execPath, [cli, 'init', '--home', join(temp, 'home')]);
  execFileSync(process.execPath, [cli, 'hub', '--home', join(temp, 'home')]);
} finally {
  // temp is created by mkdtemp, never derived from caller-controlled paths.
  await rm(temp, { recursive: true, force: true });
}
const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile('dist/SHA256SUMS', `${sha}  ${packed.filename}\n`);
console.log(`Release fuel checked: ${packed.filename}\nSHA-256 ${sha}`);
