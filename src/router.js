export class RouteError extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}
export class FuelRouter {
  constructor({ config, providers, env }, { fetchImpl = fetch, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { config, providers, env, fetchImpl, now, log });
    this.health = new Map();
    this.startedAt = this.now();
    this.activity = [];
    this.sequence = 0;
    this.totals = { requests: 0, completed: 0, failed: 0, cancelled: 0, attempts: 0, fallbacks: 0 };
  }
  record(type, requestId, row, extra = {}) {
    this.activity.push({ id: ++this.sequence, at: this.now(), type, requestId, ...(row ? { provider: row.p.id, model: row.m.id } : {}), ...extra });
    if (this.activity.length > 100) this.activity.shift();
  }
  outcome(type, requestId, row) {
    this.totals[type]++;
    if (row) row.state.lastOutcome = type;
    this.record(type, requestId, row);
  }
  snapshot() {
    const now = this.now();
    const stations = this.providers.flatMap(p => p.models.map(m => {
      const state = this.health.get(`${p.id}/${m.id}`);
      const configured = (!p.keyEnv || Boolean(this.env[p.keyEnv])) && (m.offer !== 'trial' || this.config.allowTrials);
      const status = p.keyEnv && !this.env[p.keyEnv] ? 'missing_key'
        : m.offer === 'trial' && !this.config.allowTrials ? 'trial_disabled'
        : state?.until > now ? 'cooldown'
        : state?.inFlight > 0 ? 'in_flight'
        : state?.lastOutcome === 'completed' ? 'observed_success'
        : state?.lastOutcome === 'failed' ? 'last_request_failed'
        : state?.lastOutcome === 'cancelled' ? 'last_request_cancelled' : 'unverified';
      return { provider: p.id, model: m.id, endpoint: p.baseUrl, tasks: [...m.tasks], capabilities: [...m.capabilities], offer: m.offer, priority: m.priority,
        configured, status, inFlight: state?.inFlight ?? 0, cooldownUntil: state?.until > now ? state.until : null,
        latencyMs: state?.latencyObserved ? state.latency : null, lastStatus: state?.lastStatus ?? null };
    }));
    // Explicit projection: never serialize config credentials, prompts, upstream bodies, or exceptions.
    return { startedAt: this.startedAt, now, totals: { ...this.totals }, stations, activity: this.activity.map(event => ({ ...event })) };
  }
  candidates(body) {
    const alias = body.model;
    const task = alias === 'freegas/auto' ? null : alias?.startsWith('freegas/') ? alias.slice(8) : undefined;
    if (task === undefined || task === '') throw new RouteError(404, 'unknown_model', 'That pump does not exist. Use freegas/auto or freegas/<task>.');
    const content = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []);
    if (content.some(c => !['text', 'image_url'].includes(c.type))) throw new RouteError(400, 'unsupported_content', 'This pump accepts text and image_url content.');
    const required = [];
    if (body.tools?.length || body.messages.some(m => m.tool_calls?.length || m.role === 'tool')) required.push('tools');
    if (body.response_format?.type === 'json_object') required.push('json');
    if (body.response_format?.type === 'json_schema') required.push('json_schema');
    if (content.some(c => c.type === 'image_url')) required.push('vision');
    // Conservative heuristic, not a tokenizer. Reserve extra space for images.
    const estimate = JSON.stringify({ messages: body.messages, tools: body.tools, response_format: body.response_format }).length + content.filter(c => c.type === 'image_url').length * 4096 + (body.max_completion_tokens ?? body.max_tokens ?? 1024);
    const rows = [];
    for (const p of this.providers) for (const m of p.models) {
      if (p.keyEnv && !this.env[p.keyEnv]) continue;
      if (m.offer === 'trial' && !this.config.allowTrials) continue;
      if (task && !m.tasks.includes(task)) continue;
      if (!required.every(c => m.capabilities.includes(c)) || m.context < estimate) continue;
      const key = `${p.id}/${m.id}`;
      const state = this.health.get(key) ?? { until: 0, failures: 0, latency: 0, inFlight: 0 };
      if (state.until > this.now()) continue;
      rows.push({ p, m, key, state, score: m.priority * 1000 - state.failures * 100 - state.inFlight * 50 - Math.min(state.latency / 100, 49) });
    }
    return rows.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  }
  async route(body, signal) {
    const requestId = ++this.totals.requests;
    try { return await this.routeRequest(body, signal, requestId); }
    catch (error) { this.outcome(error.status === 499 ? 'cancelled' : 'failed', requestId); throw error; }
  }
  async routeRequest(body, signal, requestId) {
    const rows = this.candidates(body);
    if (!rows.length) throw new RouteError(503, 'empty_tank', 'No eligible pumps. Check credentials, task/capability tags, context, and cooldowns with freegas doctor.');
    let attempt = 0;
    for (const row of rows) {
      const { p, m, key, state } = row;
      if (signal?.aborted) throw new RouteError(499, 'cancelled', 'Driver left the station.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, this.config.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.health.set(key, state); state.inFlight++;
      state.lastOutcome = 'in_flight';
      this.totals.attempts++;
      if (attempt++) { this.totals.fallbacks++; this.record('fallback', requestId, row); }
      this.record('attempt', requestId, row);
      const started = this.now();
      let handedOff = false;
      try {
        const response = await this.fetchImpl(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json', ...(p.keyEnv ? { authorization: `Bearer ${this.env[p.keyEnv]}` } : {}) },
          body: JSON.stringify({ ...body, model: m.id }),
        });
        if (response.ok) {
          state.latency = this.now() - started; state.latencyObserved = true; state.failures = 0; state.lastStatus = response.status;
          this.record('accepted', requestId, row, { status: response.status });
          this.log(`${p.id}: tank acquired. Model ${m.id}.`);
          let done = false; handedOff = true;
          return { response, provider: p.id, finish: (result = 'completed') => {
            if (!done) { done = true; state.inFlight--; cleanup(); this.outcome(['completed', 'cancelled'].includes(result) ? result : 'failed', requestId, row); }
          } };
        }
        const status = response.status;
        state.lastStatus = status; state.lastOutcome = 'failed';
        const retry = response.headers.get('retry-after');
        await response.body?.cancel();
        if (![401, 402, 403, 404, 408, 429].includes(status) && status < 500) {
          throw new RouteError(status, 'upstream_rejected', `Provider ${p.id} rejected the request (${status}). Check request parameters; no fallback attempted.`);
        }
        let delay = 30000;
        if (retry) { const secs = Number(retry); delay = Number.isFinite(secs) ? secs * 1000 : Date.parse(retry) - this.now(); }
        if ([401, 402, 403, 404].includes(status)) delay = 300000;
        state.until = this.now() + Math.max(1000, Math.min(Number.isFinite(delay) ? delay : 30000, 86400000));
        state.failures++;
        this.record('cooldown', requestId, row, { status, until: state.until });
        this.log(`${p.id}: pump says ${status}. Trying the next station.`);
      } catch (e) {
        if (e instanceof RouteError) throw e;
        if (signal?.aborted) { state.lastOutcome = 'cancelled'; throw new RouteError(499, 'cancelled', 'Driver left the station.'); }
        state.failures++; state.until = this.now() + 30000;
        state.lastOutcome = 'failed';
        this.record('cooldown', requestId, row, { until: state.until });
        this.log(`${p.id}: hose disconnected. Trying the next station.`);
      } finally {
        // Successful streams keep their deadline and occupancy until finish().
        if (!handedOff) { state.inFlight--; cleanup(); }
      }
    }
    throw new RouteError(503, 'all_pumps_busy', 'Every eligible Gas Station is dry. This is now a walking simulator. Wait for cooldowns or add a station; no infinite retry treadmill today.', 30);
  }
}
