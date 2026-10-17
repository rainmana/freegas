import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');
const tag = `v${version}`;
const filename = `freegas-${version}.tgz`;
const checksum = await readFile('dist/SHA256SUMS');
const hash = createHash('sha256').update(await readFile(`dist/${filename}`)).digest('hex');
if (checksum.toString() !== `${hash}  ${filename}\n`) throw new Error('Release checksum mismatch.');
const repository = process.env.GITHUB_REPOSITORY;
const headers = { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
async function get(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);
  return response.json();
}
let ref = (await get(`git/ref/tags/${tag}`)).object;
if (ref.type === 'tag') ref = (await get(`git/tags/${ref.sha}`)).object;
if (ref.type !== 'commit' || ref.sha !== process.env.GITHUB_SHA) throw new Error('Release tag does not point to the tested commit.');
// The tag endpoint only promises published releases. Authenticated listing also
// includes drafts, which lets a retry finish an interrupted asset upload.
const release = (await get('releases?per_page=100')).find(r => r.tag_name === tag);
if (!release) throw new Error('Expected draft or published release was not found.');
if (!release.draft) {
  for (const [name, digest] of [[filename, hash], ['SHA256SUMS', createHash('sha256').update(checksum).digest('hex')]]) {
    if (!release.assets.some(a => a.name === name && a.digest === `sha256:${digest}`)) throw new Error('Published release assets differ; refusing to replace them.');
  }
  console.log(`${tag} already published with matching assets.`);
} else {
  execFileSync('gh', ['release', 'upload', tag, `dist/${filename}`, 'dist/SHA256SUMS', '--repo', repository, '--clobber'], { stdio: 'inherit' });
  execFileSync('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false'], { stdio: 'inherit' });
}
