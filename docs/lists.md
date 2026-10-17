# Pre-rolls and keys

Gas Stations are providers. Pumps are models. **Pre-rolls** are JSON provider lists you can share without sharing keys. Free inference may come with data collection or training terms: check each station's policy before handing over prompts or code.

## The format

```json
{
  "version": 1,
  "name": "Team coding road trip",
  "source": "https://example.org/our-provider-notes",
  "providers": [
    {
      "id": "team-station",
      "baseUrl": "https://api.example.org/v1",
      "keyEnv": "TEAM_STATION_KEY",
      "models": [
        {
          "id": "actual-provider-model-id",
          "tasks": ["code", "review"],
          "capabilities": ["tools", "json"],
          "context": 32000,
          "priority": 75,
          "offer": "free"
        }
      ]
    }
  ]
}
```

The example domain is a placeholder; it supplies zero gallons. Use real endpoints and model IDs.

| Field | Meaning |
| --- | --- |
| `version` | Exactly `1` |
| `name` | List title; import derives a filename from this |
| `source` | Optional provenance string; no automatic fetch |
| Provider `id` | Unique simple name across installed lists |
| `baseUrl` | OpenAI-compatible root, before `/chat/completions` |
| `keyEnv` | Optional local key variable name; omit for unauthenticated local pumps |
| Model `id` | Exact upstream model identifier |
| `tasks` | Aliases exposed as `freegas/<task>` |
| `capabilities` | `tools`, `vision`, `json` (object mode), `json_schema` (schema mode); empty array allowed |
| `context` | Conservative usable token budget, including output |
| `priority` | 0–100; higher wins |
| `offer` | `free`, `trial`, or `local`; metadata, not billing enforcement |

Unknown fields, including inline `apiKey`/`api_key`, are rejected. URLs require HTTPS except loopback HTTP. No URL credentials, queries, or fragments. Custom auth headers and native non-OpenAI protocols need adapters and are unsupported. Limits: 1 MB per list, 100 providers per list, 100 models per provider.

Capabilities and context are author declarations. OpenRouter's free router uses a changing pool; the starter's 32K context is a routing budget, not a guarantee for every selected model. Freegas does not probe capabilities or verify pricing.

## Import and export

```sh
freegas import ./team-code.json
freegas import https://example.org/team-code.json
freegas export team-coding-road-trip
```

Import installs and enables a new list. Duplicate provider IDs and filename collisions are rejected. Export prints validated JSON; redirect stdout to share it. Updates: stop the server, edit `.freegas/lists/*.json`, run `freegas doctor`, then restart. Remove a list from `config.json`'s `lists` array to disable it; retain at least one. No live reload or background sync.

Inspect lists before importing: a malicious list can name an existing environment variable and send its value to its endpoint. Validation does not certify the operator. Import itself makes no inference calls.

## Credentials without shell-history confetti

Create a private file outside your repository:

```json
{
  "GROQ_API_KEY": "your-key",
  "OPENROUTER_API_KEY": "your-other-key"
}
```

```sh
freegas credentials /absolute/path/to/my-keys.json
freegas doctor
```

Keys merge into `.freegas/credentials.json`. Process variables override imported keys, including empty values to temporarily disable one. POSIX files use mode `0600`; on Windows, protect the directory using your account's filesystem ACLs. Storage is plaintext. Protect the original import file too. Keep custom `--home` directories private and outside Git.

`FREEGAS_API_KEY` protects the local endpoint; set it in the server's environment. Importing provider credentials does not configure that token.

## From an existing directory

Use [Free-LLM](https://github.com/nejib1/Free-LLM) to discover providers, verify endpoint/model/capability/account terms, then translate selected entries into the format above. Native APIs and signup-credit offers cannot safely be treated as interchangeable table rows. Arbitrary Markdown import is not implemented.

Starter references: [Groq model](https://console.groq.com/docs/model/llama-3.3-70b-versatile), [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [OpenRouter free router](https://openrouter.ai/openrouter/free/apps). No live quota or inference was verified.
