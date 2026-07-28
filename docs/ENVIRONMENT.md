# Environment variables

Every setting, with safe placeholders. `.env.example` is the copyable version.

Nothing here is prefixed `NEXT_PUBLIC_`, so no value can reach a browser bundle.
Configuration is parsed and validated once, in `packages/config`; an invalid
value fails at start-up with the field named, rather than at the first request
that needed it.

Files are loaded from the repository root — `.env.local` first, then `.env` — and
an existing environment variable always wins. The website loads them through its
own config file, because Next reads `.env` from the app directory and this is a
workspace.

## Core

| Variable               | Default                 | Notes                                                                             |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `CAIRN_MODE`           | `demo`                  | `demo` needs no external accounts; `cloud` expects them                           |
| `CAIRN_APP_URL`        | `http://localhost:3000` | Must be the real HTTPS origin in production — cookies are marked `Secure` from it |
| `CAIRN_LOCAL_DATA_DIR` | `.cairn`                | Resolved against the workspace root, so every process opens the same database     |
| `NODE_ENV`             | `development`           |                                                                                   |
| `LOG_LEVEL`            | `info`                  | `debug`, `info`, `warn`, `error`                                                  |

## Encryption

| Variable                   | Required        | Notes                                                                                |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `CAIRN_MASTER_KEY`         | yes, with `env` | 32 random bytes, base64. **Losing it makes every workspace permanently unreadable.** |
| `CAIRN_MASTER_KEY_VERSION` | no              | Recorded with each wrapped key; useful when rotating                                 |
| `CAIRN_KEY_PROVIDER`       | no              | `env` or `kms`                                                                       |
| `CAIRN_KMS_KEY_ID`         | with `kms`      | Fails loudly if `kms` is selected without a registered client                        |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Database

| Variable       | Default | Notes                                       |
| -------------- | ------- | ------------------------------------------- |
| `DATABASE_URL` | unset   | Unset means the local in-process PostgreSQL |
| `DATABASE_SSL` | `true`  | Ignored for localhost                       |

## Sign-in

| Variable                                                    | Notes                              |
| ----------------------------------------------------------- | ---------------------------------- |
| `AUTH_PROVIDER`                                             | `fixture` or `workos`              |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI` | All required together for `workos` |
| `CAIRN_SESSION_SECRET`                                      | At least 32 random characters      |

With `fixture`, the sign-in code is printed to the server log instead of emailed,
and the interface says so rather than pretending mail was sent.

## AI

| Variable                                                | Default                     | Notes                            |
| ------------------------------------------------------- | --------------------------- | -------------------------------- |
| `AI_PROVIDER`                                           | `fixture`                   | `fixture` \| `openai` \| `local` |
| `OPENAI_API_KEY`                                        |                             | Required for `openai`            |
| `OPENAI_BASE_URL`                                       | `https://api.openai.com/v1` |                                  |
| `OPENAI_EXTRACTION_MODEL`                               | `gpt-5-mini`                |                                  |
| `OPENAI_EMBEDDING_MODEL`                                | `text-embedding-3-small`    | Must produce 1536 dimensions     |
| `LOCAL_AI_BASE_URL`                                     |                             | Any OpenAI-compatible endpoint   |
| `LOCAL_AI_EXTRACTION_MODEL`, `LOCAL_AI_EMBEDDING_MODEL` |                             |                                  |

`fixture` means the built-in deterministic extractor and embedder: free, private,
and the reason a fresh checkout is genuinely useful. Requests to OpenAI are sent
with `store: false`.

An embedding model returning a different width is rejected at the call rather
than silently corrupting the index.

## Storage and queue

| Variable                                    | Default             | Notes                                                                                                                      |
| ------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`                          | `local`             | `local` \| `supabase`                                                                                                      |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |                     | Server-only                                                                                                                |
| `SUPABASE_STORAGE_BUCKET`                   | `cairn-raw-sources` | Keep it private                                                                                                            |
| `QUEUE_PROVIDER`                            | `postgres`          | The job table works on Supabase too                                                                                        |
| `CAIRN_INLINE_JOBS`                         | `auto`              | `auto` drains inline only on the local database; `always` runs a single-user deployment with no worker; `never` forces one |

## Connectors

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`

Each group is all-or-nothing: partial configuration reports setup-required rather
than half-working. `GITHUB_APP_PRIVATE_KEY` accepts `\n` escapes.

## MCP

| Variable                                                       | Default | Notes                                |
| -------------------------------------------------------------- | ------- | ------------------------------------ |
| `MCP_AUTH_MODE`                                                | `local` | `local` connection codes, or `oauth` |
| `CAIRN_MCP_LOCAL_TOKEN`                                        |         | Development convenience only         |
| `MCP_OAUTH_ISSUER`, `MCP_OAUTH_JWKS_URL`, `MCP_OAUTH_AUDIENCE` |         | All required for `oauth`             |

## Limits

| Variable                          | Default    | Notes                                                    |
| --------------------------------- | ---------- | -------------------------------------------------------- |
| `CAIRN_AI_MONTHLY_BUDGET_USD`     | `5`        | Per-workspace default; each workspace can change its own |
| `CAIRN_AI_SOFT_LIMIT_RATIO`       | `0.8`      | Where the warning appears                                |
| `CAIRN_MAX_UPLOAD_BYTES`          | `10485760` | 10 MB                                                    |
| `CAIRN_MAX_EXTRACTION_CHARS`      | `24000`    | Ceiling per model request                                |
| `CAIRN_ALLOW_INSECURE_URL_IMPORT` | `false`    | **Tests only.** Disables the request-forgery guard.      |

## Observability

`SENTRY_DSN` sends exception type, message, and explicit tags only — never
request bodies, breadcrumbs, or content. Unset means structured logs and nothing
external. `OTEL_EXPORTER_OTLP_ENDPOINT` is accepted for a future exporter.

## Worker

`CAIRN_WORKER_POLL_MS` (default `1000`) and `CAIRN_WORKER_BATCH` (default `5`).
The worker backs off while idle.
