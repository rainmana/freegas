const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
if (!repository || !token) throw new Error('GitHub workflow context required.');
const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' };
for (const pr of JSON.parse(process.env.RELEASE_PRS || '[]')) {
  if (!Number.isInteger(pr.number) || pr.number < 1) throw new Error('Invalid release PR number.');
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${pr.number}`, { headers });
  if (!response.ok) throw new Error(`Could not inspect release PR (${response.status}).`);
  const detail = await response.json();
  if (detail.head.repo.full_name !== repository || detail.base.ref !== 'main' || !detail.head.ref.startsWith('release-please--branches--main')) throw new Error('Unexpected release PR destination.');
  for (const workflow of ['test.yml', 'hub.yml']) {
    const dispatched = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref: detail.head.ref }) });
    if (!dispatched.ok) throw new Error(`Could not dispatch ${workflow} (${dispatched.status}).`);
    console.log(`Dispatched ${workflow} for version PR #${pr.number}, commit ${detail.head.sha}.`);
  }
}
