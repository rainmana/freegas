# Kick the tires

No provider keys, paid inference, or npm dependencies are needed for the default tests.

```sh
npm test
npm run test:coverage
npm run test:user
npm run package
```

`npm test` discovers every `test/*.test.js` file. The coverage command runs the same tests and enforces 95% line, 90% branch, and 90% function coverage for `src/`. CLI subprocess behavior and release scripts have separate behavioral tests; the core coverage percentage does not include them. All six Windows/Linux/macOS × Node 22/24 CI jobs enforce these thresholds and test the extracted release package.

## What the tests protect

| Area | Regression checks |
| --- | --- |
| Community lists and storage | Invalid fields, URL credentials, unsafe URLs, traversal, duplicate providers/models, corrupt or oversized files, private file permissions on Unix, exclusive-write preservation |
| Credentials | Environment overrides imported keys; imports merge; invalid imports preserve existing storage; exported lists and logs omit secret values |
| Selection | Task aliases, trial opt-in, tools and tool history, images, JSON and JSON schema, context/output reserves, priority and active-request balancing |
| Recovery | Retry status classification, bounded seconds/date `Retry-After`, cooldown expiry, timeout/network fallback, cancellation, idempotent occupancy cleanup, no replay after accepting a response |
| HTTP and dashboard | Authentication, same-origin dashboard access, hostile Host headers, blocked browser origins for inference, body limits, malformed request shapes, exact MIME types, sanitized errors, SSE bytes and client disconnects |
| CLI user journeys | Real child processes initialize, import credentials and lists, export into a second installation, diagnose missing keys, serve requests, complete a file-writing tool loop, stream fragmented UTF-8/SSE, handle port conflicts, and shut down |
| Releases | Exact tested merge commit, version manifest consistency, API failures, artifact digests, safe published-release retries, extracted package commands and assets |

These tests assert observable behavior; they do not benchmark model quality or establish any provider's free quota. The subprocess tests remove inherited inference API keys, use temporary homes and loopback servers, and verify actual file contents after the tool call. On Unix, shutdown checks the graceful signal exit; Windows process termination is checked separately because its signal behavior differs.

## Open the real dashboard

```sh
node bin/freegas.js serve
```

`serve` opens the real dashboard at `http://127.0.0.1:4040/`, or the port you select with `--port`. Use `--no-open` to skip launching a browser. If your desktop has no browser launcher, the server keeps running and prints the URL. The dashboard and inference API share one process and port. It shows your configured lists and the routing activity that actually happens in that process. It makes no inference probes. The previous transcript viewer has been removed.

The dashboard polls the read-only `/api/status` endpoint once per second. Configuration is loaded at startup, so restart after editing lists or credentials. “Untested” does not mean online. “Observed success” means a response completed in this process, not that the provider remains reachable or has free quota. A stream that fails after its headers arrived is a failed trip. Header latency measures time to response headers, not full generation time. The latest 100 events and counters reset on restart.

If `FREEGAS_API_KEY` is set, enter that same local token in the dashboard. The token is held only in the page's memory; it is not saved in browser storage or placed in a URL. Station details require authorization. Cross-origin status requests and non-loopback Host headers are rejected; inference continues to reject browser origins. Prompts, response bodies, upstream exceptions, and credential values are excluded from telemetry.

Unit and HTTP tests cover dashboard state transitions, bounded history, authentication, origin/Host checks, static assets, and Windows/macOS/Linux browser launcher commands. The CLI user journey checks the dashboard served by the actual child process before and after routing requests. Browser rendering and controls are checked separately against the running app.

The automated user-test fixtures deliberately return a 429, an OpenAI-compatible tool call, and an SSE stream. They spend no inference credits. The README screenshot is captured from the real app using a separately configured Venice station and observed live requests; Venice access may be billable. The separate actual Hub gateway and opt-in live harness checks are documented in [the verification record](verification.md).
