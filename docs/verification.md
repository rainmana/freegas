# Road-test record

Observed locally on 2026-10-17, Windows x64, Node.js 25.9.0:

| Check | Result |
| --- | --- |
| Unit/local HTTP/CLI and release guards | 12 tests passed |
| Source syntax | `npm run check` passed |
| Release package | `.tgz` extracted; packaged help, init, and Hub config generation passed |
| Workflow syntax | actionlint 1.7.12 passed |
| Actual Hub, deterministic providers | Nonstream tool loop wrote a verified file; 429 fell back once and cooldown prevented repeat hits; streamed text survived |
| Actual Hub, live Venice | Tool round trip and streamed text passed |
| OpenCode 1.19.3 → Hub → Freegas → Venice | Streamed coding session completed a `write` tool call; resulting file contained `FREEGAS_HARNESS_OK` |
| Content tracing control | Hub launched with `TRACE_CONTENT_ENABLED=false`; the test prompt was absent from captured service logs |

Hub revision: `e1be468f87de077ce066fbdebc858e913dc889a1` (0.10.1). Locally built with the installed stable LLVM/MinGW Rust toolchain. Its committed lockfile still calls the root package 0.9.3; the build helper changes that one metadata value to 0.10.1 and leaves dependencies locked.

The live model was Venice's `qwen3-coder-480b-a35b-instruct-turbo`, selected from its authenticated model catalog. It was used only in an isolated opt-in test configuration with the existing `VENICE_API_KEY`. This demonstrates inference compatibility, **not** free-tier availability or a zero-cost run. It is not silently added to the starter Pre-roll. Provider billing remains provider-controlled.

The OpenCode session used a disposable directory and isolated configuration/data/cache directories. It received a placeholder local key, with upstream API keys removed from its environment. Its permissions allowed file reads/writes and denied shell execution and external-directory access. The test verified the file content and completed tool event, not just the model's claim of success.

## Reproduce

```sh
npm run check
npm test
npm run package
node scripts/build-hub.js
npm run test:hub
```

`HUB_BIN` can point at another already-built Hub executable. The report records the expected revision; ensure an overridden binary actually corresponds to it. Reports are written to ignored `.integration/*-report.json` files.

Live tests explicitly require a Venice key and may consume provider credits:

```sh
npm run test:hub -- --live
```

Set `FREEGAS_LIVE_MODEL` to override the documented model. To reproduce the named harness test, install OpenCode into the ignored integration directory first:

```sh
npm install --prefix .integration/opencode --no-audit --no-fund opencode-ai@1.19.3
npm run test:hub -- --live --opencode
```

Use `OPENCODE_BIN` for another installation. The harness step has a two-minute deadline; upstream requests have bounded timeouts. Test configuration, files, and child processes are cleaned up after each run; the ignored harness event log is retained for local diagnosis. No upstream keys are written into reports or harness configuration.

## Limits

The hosted Windows/Linux/macOS Node 22/24 matrix and Linux Rust 1.88.0 Hub build must be observed on the implementation PR before calling those platforms verified. Release guard tests and workflow validation do not prove that GitHub has published a release. Actual tag/release creation is intentionally reserved for a merged version PR after successful post-merge checks.

The observed session is a small tool-writing task, not a coding-quality benchmark. Other providers, large repositories, partial tool-delta variations, images, strict JSON schemas, Responses API, and native Anthropic Messages remain outside this record.
