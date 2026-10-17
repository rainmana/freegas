import { spawn } from 'node:child_process';

export function openDashboard(url, { platform = process.platform, spawnImpl = spawn, onError = () => {} } = {}) {
  const [command, args] = platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawnImpl(command, args, { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
    child.once('error', onError);
    child.once('exit', code => { if (code) onError(); });
    child.unref();
  } catch { onError(); }
}
