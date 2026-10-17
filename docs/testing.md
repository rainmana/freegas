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
| HTTP | Authentication, blocked browser origins, body limits, malformed request shapes, exact MIME types, sanitized errors, SSE bytes and client disconnects |
| CLI user journeys | Real child processes initialize, import credentials and lists, export into a second installation, diagnose missing keys, serve requests, complete a file-writing tool loop, stream fragmented UTF-8/SSE, handle port conflicts, and shut down |
| Releases | Exact tested merge commit, version manifest consistency, API failures, artifact digests, safe published-release retries, extracted package commands and assets |

These tests assert observable behavior; they do not benchmark model quality or establish any provider's free quota. The subprocess tests remove inherited inference API keys, use temporary homes and loopback servers, and verify actual file contents after the tool call. On Unix, shutdown checks the graceful signal exit; Windows process termination is checked separately because its signal behavior differs.

## Reproduce the screenshot

```sh
npm run demo
```

The command first runs the automated CLI user journeys. After they pass, it serves a local transcript viewer at the printed loopback URL. The README screenshot is a browser capture of that viewer, with real recorded CLI output and asserted HTTP/tool results. Paths and ephemeral ports are replaced with placeholders; fixture keys are never displayed. The viewer is a documentation tool, not a Freegas dashboard. Close it with Ctrl+C.

The local fixtures deliberately return a 429, an OpenAI-compatible tool call, and an SSE stream. They spend no inference credits. The separate actual Hub gateway and opt-in live harness checks are documented in [the verification record](verification.md).
