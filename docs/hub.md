# Hub in the driver's seat

Traceloop Hub provides the gateway. Freegas is its OpenAI-compatible backend for Gas Station selection and fallback. Freegas generates configuration; it does not embed Hub.

## Local binary

Install/build Hub using its [upstream instructions](https://github.com/traceloop/hub). The tested revision is `e1be468f87de077ce066fbdebc858e913dc889a1` (0.10.1). With Rust installed, `node scripts/build-hub.js` clones that revision and builds it into the ignored `.integration/hub` directory. It corrects only Hub's stale root-package version in `Cargo.lock`, then builds with `--locked`; dependency versions/checksums remain unchanged. CI uses Rust 1.88.0. On Windows with LLVM/MinGW Rust, set `HUB_RUST_TOOLCHAIN=stable-x86_64-pc-windows-gnullvm` before building.

Then:

```powershell
freegas hub
freegas serve
```

In another PowerShell terminal, replace the path with the printed configuration path:

```powershell
$env:CONFIG_FILE_PATH = 'C:\path\to\freegas\.freegas\hub.yaml'
$env:PORT = '3000'
$env:TRACE_CONTENT_ENABLED = 'false'
hub
```

macOS/Linux equivalent:

```sh
CONFIG_FILE_PATH="$PWD/.freegas/hub.yaml" PORT=3000 TRACE_CONTENT_ENABLED=false hub
```

Generated JSON is valid YAML. It registers one OpenAI backend at `http://127.0.0.1:4040/v1`, aliases for installed task tags, and a chat pipeline. The tested Hub ignores `general.trace_content_enabled` in YAML mode, so **the explicit `TRACE_CONTENT_ENABLED=false` environment setting is required**. Generation refuses to overwrite files; rename/remove the generated file before regenerating after list changes.

| Interface | Base URL | Model |
| --- | --- | --- |
| Through Hub | `http://127.0.0.1:3000/api/v1` | `freegas/code` |
| Direct Freegas | `http://127.0.0.1:4040/v1` | `freegas/code` |

Hub's prefix is `/api/v1`. Check `GET /health` on both, then send a small Chat Completions request to Hub. Freegas offers `GET /v1/models`; a harness using Hub may require manual model entry.

## Local token

Set `FREEGAS_API_KEY` before generating config and starting either process. The generator writes the literal `${FREEGAS_API_KEY}` reference, never the secret; Hub interpolates it. This protects the Freegas backend only. It does not add gateway authentication to Hub.

Freegas binds only to `127.0.0.1`. Hub controls its own listener and authentication. Keep Hub local or behind access controls. A placeholder harness API key does not secure the gateway.

## Docker

A container's loopback belongs to the container. Running both binaries on the host is the simplest supported layout. Hub on Linux can use Docker `--network host` to reach host Freegas with the generated backend URL.

Docker Desktop networking can require a non-loopback Freegas listener, which this version does not offer. A two-container Compose setup is not supplied or tested. Changing the URL to `host.docker.internal` alone does not guarantee connectivity.

## OpenCode

OpenCode 1.19.3 completed an actual streamed file-writing session through Hub → Freegas → Venice. In your OpenCode configuration:

```json
{
  "provider": {
    "freegas": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Freegas",
      "options": {
        "baseURL": "http://127.0.0.1:3000/api/v1",
        "apiKey": "freegas-local"
      },
      "models": {
        "freegas/code": {
          "name": "Freegas coding pump",
          "limit": { "context": 32000, "output": 2048 }
        }
      }
    }
  }
}
```

```sh
opencode run --model freegas/freegas/code "Explain this project"
```

Use a tool-capable Pre-roll, set context/output limits to match your models, and follow OpenCode's normal permissions for coding tasks. The double `freegas` is intentional: the first is the OpenCode provider ID; `freegas/code` is the model alias sent to Hub. Provider API credentials belong to Freegas, not the harness. If you enabled the Freegas backend token, Hub needs that token; the client placeholder above does not authenticate Hub's gateway.

## Verification scope

Fields were checked against Hub's [example configuration](https://github.com/traceloop/hub/blob/main/config-example.yaml), [OpenAI provider](https://github.com/traceloop/hub/blob/main/src/providers/openai/provider.rs), and [routes](https://github.com/traceloop/hub/blob/main/src/routes.rs). Tests inspect generated config and exercise Freegas with local HTTP mock providers.

The actual pinned Hub passed quota fallback, a tool loop with a verified file side effect, and streamed text. A live Venice run and OpenCode coding session also passed. Hub parses/reserializes messages and streams; those checks cover the tested setup and do not guarantee every provider's tool-delta schema, image input, or structured-output mode. See [the test record and reproduction commands](verification.md).
