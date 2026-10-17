import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';

// Record real CLI processes + HTTP requests against disposable local fixtures.
// Never render hand-written command output or use a developer's inference keys.
const child = spawn(process.execPath, ['--test', 'test/user.test.js'], {
  env: { ...process.env, FREEGAS_RECORD_DEMO: '1' }, stdio: 'inherit',
});
const [code] = await once(child, 'exit');
if (code !== 0) process.exit(code ?? 1);
const { transcript } = JSON.parse(await readFile('.integration/demo-transcript.json', 'utf8'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sections = transcript.filter(row => !row.command.startsWith('freegas init') && !row.command.includes('stream: true'));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Freegas — recorded road trip</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0a1218;color:#dce9e4;font:15px/1.5 Consolas,monospace;padding:32px}
main{max-width:1180px;margin:auto;border:1px solid #31423f;border-radius:16px;overflow:hidden;background:#111d23}
header{padding:20px 28px;border-bottom:1px solid #31423f;display:flex;align-items:center;gap:16px}
img{width:64px;height:64px}h1{font:700 25px/1.2 system-ui;margin:0;color:#66edb1}header p{margin:6px 0 0;color:#adbfba;font:14px system-ui}
article{padding:12px 28px 20px;display:grid;grid-template-columns:1fr 1fr;gap:6px 28px}section{min-width:0}section:last-child{grid-column:2;grid-row:1 / span 3;border-left:1px solid #31423f;padding-left:28px}
h2{font:600 14px/1.4 Consolas,monospace;color:#66edb1;margin:16px 0 8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:13px/1.65 Consolas,monospace}
footer{padding:14px 28px;background:#192a2e;font:13px/1.5 system-ui;color:#c9d7d2}strong{color:#ffd166}
</style><main><header><img src="/icon.png" alt="Freegas pump"><div><h1>FREEGAS / the complimentary fuel aisle</h1><p>Ass, gas, or grass - nobody rides for free.</p></div></header><article>
${sections.map(row => `<section><h2>$ ${escape(row.command)}</h2><pre>${escape(row.output.trimEnd().replaceAll(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>'))}</pre></section>`).join('\n')}
</article><footer><strong>Recorded CLI + harness test</strong> · Local fixture providers simulate a 429 and a working tool-capable model.<br>Real processes, HTTP requests, and verified file output. No live provider, free-quota, or model-quality claim.</footer></main></html>`;
const icon = await readFile('assets/freegas-icon.png');
const server = http.createServer((req, res) => {
  if (req.url === '/icon.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(icon); }
  else if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" }); res.end(html); }
  else { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`Recorded demo: http://127.0.0.1:${server.address().port}/ (Ctrl+C to close)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
