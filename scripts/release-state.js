import { appendFile, readFile } from 'node:fs/promises';

const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const token = process.env.GH_TOKEN;
if (!repository || !sha || !token || !process.env.GITHUB_OUTPUT) throw new Error('GitHub workflow context required.');
const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}/pulls`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
if (!response.ok) throw new Error(`Could not inspect merged version PR (${response.status}).`);
const prs = await response.json();
const releasePr = prs.find(pr => pr.merged_at && pr.merge_commit_sha === sha && pr.base.ref === 'main' && pr.head.ref.startsWith('release-please--branches--main') && pr.labels.some(l => ['autorelease: pending', 'autorelease: tagged'].includes(l.name)));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('.release-please-manifest.json', 'utf8'));
if (pkg.version !== manifest['.']) throw new Error('Version manifest disagrees with package.json.');
await appendFile(process.env.GITHUB_OUTPUT, `candidate=${Boolean(releasePr)}\nversion=${pkg.version}\n`);
console.log(releasePr ? `Version PR #${releasePr.number} merged at tested commit ${sha}.` : 'No version PR merged at this exact commit; tag/release creation skipped.');
