import http from 'node:http';
import { once } from 'node:events';
import { RouteError } from './router.js';

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
export function createServer(router, { token } = {}) {
  return http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    let routed;
    try {
      if (req.url === '/health' && req.method === 'GET') return json(res, 200, { status: 'ok', message: 'Station open. Provider availability sold separately.' });
      if (req.headers.origin) throw new RouteError(403, 'browser_blocked', 'This pump serves local harnesses. Browser origins are blocked.');
      if (token && req.headers.authorization !== `Bearer ${token}`) throw new RouteError(401, 'unauthorized', 'Wrong fuel cap key. Check your local API token.');
      if (req.url === '/v1/models' && req.method === 'GET') {
        const tasks = new Set(router.providers.flatMap(p => p.models.flatMap(m => m.tasks)));
        return json(res, 200, { object: 'list', data: ['auto', ...tasks].filter((v, i, a) => a.indexOf(v) === i).map(t => ({ id: `freegas/${t}`, object: 'model', created: 0, owned_by: 'freegas' })) });
      }
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') throw new RouteError(404, 'not_found', 'Wrong driveway. Try POST /v1/chat/completions.');
      if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new RouteError(415, 'content_type', 'The tank takes application/json.');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new RouteError(413, 'too_large', 'Two megabytes of prompt is enough gas for one trip.'); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new RouteError(400, 'invalid_json', 'JSON has sprung a leak. Check the syntax.'); }
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => !m || typeof m !== 'object' || typeof m.role !== 'string') || typeof body.model !== 'string') throw new RouteError(400, 'invalid_request', 'Provide model and a nonempty messages array.');
      if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new RouteError(400, 'invalid_request', 'stream must be true or false.');
      for (const key of ['max_tokens', 'max_completion_tokens']) if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 1)) throw new RouteError(400, 'invalid_request', `${key} must be a positive integer.`);
      if (body.tools !== undefined && !Array.isArray(body.tools)) throw new RouteError(400, 'invalid_request', 'tools must be an array.');
      if (body.response_format !== undefined && (!body.response_format || !['text', 'json_object', 'json_schema'].includes(body.response_format.type))) throw new RouteError(400, 'invalid_request', 'response_format needs type: text, json_object, or json_schema.');
      if (body.messages.some(m => m.content !== undefined && m.content !== null && typeof m.content !== 'string' && !Array.isArray(m.content))) throw new RouteError(400, 'invalid_request', 'Message content must be text, an array, or null.');
      if (body.messages.some(m => Array.isArray(m.content) && m.content.some(c => !c || typeof c !== 'object'))) throw new RouteError(400, 'invalid_request', 'Content parts must be objects.');
      routed = await router.route(body, controller.signal);
      const type = routed.response.headers.get('content-type') ?? '';
      const mediaType = type.split(';', 1)[0].trim().toLowerCase();
      if (mediaType !== (body.stream ? 'text/event-stream' : 'application/json')) {
        // Release an unread/indefinitely open body before finish() clears its deadline.
        if (routed.response.body) await routed.response.body.cancel().catch(() => {});
        throw new RouteError(502, 'invalid_upstream', 'The pump returned the wrong fuel type.');
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-freegas-provider': routed.provider });
      for await (const chunk of routed.response.body) {
        if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
      }
      res.end();
    } catch (e) {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) json(res, e.status ?? 500, { error: { code: e.code && e instanceof RouteError ? e.code : 'station_error', type: 'freegas_error', message: e instanceof RouteError ? e.message : 'Station trouble. Check local configuration; upstream details withheld.' } }, e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {});
    } finally { routed?.finish(); }
  });
}
