const get = id => document.getElementById(id);
let token = '';
let paused = false;
let busy = false;
let snapshot;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function statusFor(row, now) {
  const seconds = Math.max(0, Math.ceil((row.cooldownUntil - now) / 1000));
  return {
    missing_key: ['Missing key', 'warn'], trial_disabled: ['Trial parked', 'muted'],
    cooldown: [`Cooling · ${seconds}s`, 'warn'], in_flight: [`Pumping · ${row.inFlight}`, ''],
    observed_success: ['Observed success', ''], last_request_failed: ['Last request failed', 'bad'],
    last_request_cancelled: ['Last request cancelled', 'muted'], unverified: ['Untested', 'muted'],
  }[row.status];
}
function render(data) {
  snapshot = data;
  get('configured').textContent = `${data.stations.filter(s => s.configured).length} / ${data.stations.length}`;
  get('active').textContent = data.stations.reduce((total, row) => total + row.inFlight, 0);
  get('completed').textContent = data.totals.completed;
  get('failures').textContent = `${data.totals.failed} failed · ${data.totals.cancelled} cancelled · ${data.totals.requests} routed`;
  get('fallbacks').textContent = data.totals.fallbacks;
  get('station-count').textContent = `${data.stations.length} model pump(s)`;
  const rows = data.stations.map(row => {
    const tr = element('tr');
    const name = element('td'); name.append(element('strong', row.provider), element('small', row.model, 'model'), element('small', row.endpoint));
    const fuel = element('td'); fuel.append(element('strong', row.offer), element('small', row.tasks.join(' · ')), element('small', row.capabilities.join(' · ') || 'text'));
    const status = element('td'); const [label, tone] = statusFor(row, data.now); status.append(element('span', label, `badge ${tone}`));
    if (row.lastStatus !== null) status.append(element('small', `Last HTTP ${row.lastStatus}`));
    const latency = element('td', row.latencyMs === null ? '—' : `${Math.round(row.latencyMs)} ms`);
    tr.append(name, fuel, status, latency); return tr;
  });
  if (!rows.length) { const tr = element('tr'); const td = element('td', 'No model pumps configured.', 'empty'); td.colSpan = 4; tr.append(td); rows.push(tr); }
  get('stations').replaceChildren(...rows);
  const labels = { attempt: 'Pulling up to the pump', fallback: 'Trying the next station', accepted: 'Response headers received', completed: 'Trip completed', failed: 'Trip failed', cancelled: 'Driver left the station', cooldown: 'Pump cooling down' };
  const events = [...data.activity].reverse().map(event => {
    const tone = event.type === 'failed' ? 'bad' : ['cooldown', 'fallback'].includes(event.type) ? 'warn' : '';
    const li = element('li', undefined, 'event'); const detail = element('div');
    const head = element('div', undefined, 'event-head');
    const time = element('time', new Date(event.at).toLocaleTimeString()); time.dateTime = new Date(event.at).toISOString();
    head.append(element('strong', labels[event.type]), time);
    detail.append(head);
    if (event.provider) detail.append(element('p', `${event.provider} / ${event.model}`));
    detail.append(element('small', `Trip #${event.requestId}${event.status ? ` · HTTP ${event.status}` : ''}`));
    li.append(element('span', undefined, `dot ${tone}`), detail); return li;
  });
  get('activity').replaceChildren(...(events.length ? events : [element('li', 'No trips yet. Point your harness at the inference URL below. The complimentary fuel vouchers await.', 'empty')]));
  get('updated').textContent = `Updated ${new Date(data.now).toLocaleTimeString()}`;
  get('session').textContent = `Since ${new Date(data.startedAt).toLocaleTimeString()} · History resets on restart · ${paused ? 'Updates paused' : 'Updates every second'}`;
}
async function refresh() {
  if (busy) return;
  busy = true;
  get('refresh').disabled = true;
  try {
    const response = await fetch('/api/status', { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (response.status === 401) {
      get('unlock').hidden = false;
      get('connection').textContent = 'Locked'; get('connection').className = 'badge warn';
      get('notice').textContent = 'Enter the local API token to view station details.'; get('notice').hidden = false;
      return;
    }
    if (!response.ok) throw new Error('status unavailable');
    render(await response.json());
    get('unlock').hidden = true; get('notice').hidden = true;
    get('connection').textContent = paused ? 'Updates paused' : 'Station open'; get('connection').className = paused ? 'badge muted' : 'badge';
  } catch {
    get('connection').textContent = 'Disconnected'; get('connection').className = 'badge bad';
    get('notice').textContent = snapshot ? 'The station stopped responding. Values below are stale; reconnecting automatically.' : 'Cannot reach the station. Check that freegas serve is still running.';
    get('notice').hidden = false;
  } finally { busy = false; get('refresh').disabled = false; }
}
get('unlock').addEventListener('submit', event => { event.preventDefault(); token = get('token').value; get('token').value = ''; refresh(); });
get('refresh').addEventListener('click', refresh);
get('pause').addEventListener('click', () => {
  paused = !paused; get('pause').textContent = paused ? 'Resume updates' : 'Pause updates';
  if (paused) { get('connection').textContent = 'Updates paused'; get('connection').className = 'badge muted'; if (snapshot) render(snapshot); }
  else refresh();
});
get('dashboard-url').textContent = location.origin;
get('api-url').textContent = `${location.origin}/v1`;
setInterval(() => { if (!paused) refresh(); }, 1000);
refresh();
