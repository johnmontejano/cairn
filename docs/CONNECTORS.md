# Connectors

Every connector is read-only. Nothing in a place you connect is ever changed,
moved, or deleted. The only exception is the GitHub memory mirror, which is a
separate opt-in that writes only your own canonical Markdown.

## Always available

| Connector          | What it reads                  | Setup |
| ------------------ | ------------------------------ | ----- |
| **Paste text**     | Only what you paste            | None  |
| **Upload a file**  | Only the files you choose      | None  |
| **Add a web page** | The page at that address, once | None  |

Uploads support Markdown, plain text, PDF, Word (`.docx`), CSV, and JSON. A PDF
with no selectable text is accepted and the interface says it may be a scan;
text recognition is not implemented.

URL import refuses non-HTTPS schemes, private and loopback addresses, cloud
metadata addresses, service ports, oversized responses, and unsupported content
types — and re-checks every redirect, because a public hostname redirecting to an
internal address is the whole point of the attack.

## Needs setup

### Google Drive

Scope: `drive.readonly` and nothing else. A grant wider than requested is
refused rather than accepted.

Google Docs, Sheets, and Slides are exported as text rather than downloaded,
because their native format is not something a citation can point into. PDFs,
Word documents, and text files are downloaded as-is.

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
GOOGLE_REDIRECT_URI=https://your-app.example.com/api/oauth/google/callback
```

In the Google Cloud console: enable the Drive API, create an OAuth client, and
register that exact redirect. Refresh tokens are encrypted with a key derived
separately from the one protecting content, and bound to their connection row.

### GitHub

A GitHub App rather than a personal access token: installation-scoped, narrow
permissions, short-lived credentials, and revocable without touching an account
password. It reads text and Markdown files in the repositories you install it on.

```
GITHUB_APP_ID=…
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…"
GITHUB_WEBHOOK_SECRET=…
```

Permissions: **Contents: read-only**. Events: **Push**. Webhook URL:
`https://your-app.example.com/api/webhooks/github`.

Webhooks follow GitHub's own guidance: the signature is verified in constant time
before the payload is touched, `X-GitHub-Delivery` recognises redeliveries, the
work is queued rather than done inline, and the response is immediate. The
response is the same whether or not anything matched, so a sender cannot learn
which workspaces exist.

## Without credentials

A connector with no credentials reports **setup required** rather than pretending
to work. You can still add it to see how it would behave: it uses clearly
labelled sample documents and the interface says so. Paste, upload, and URL
import remain fully functional.

## The optional GitHub mirror

Off by default. When enabled, canonical Markdown is written to a repository you
choose — a copy, not a second source of truth. Treating a mirror as writable is
how sync loops start, so it is a plain per-file upsert with no merge.

## Adding one

Implement `SourceConnector` in `packages/connectors`:

```ts
readonly provider: SourceProvider;
readonly displayName: string;
readonly permissionSummary: string;   // ordinary language, shown before connecting
readonly readOnly: true;
status(): 'ready' | 'demo' | 'setup-required';
list(input): Promise<{ items: FetchedSource[]; nextCursor: string | null }>;
```

Then add an entry to `CONNECTOR_DESCRIPTIONS` — it lives next to the connectors
so what a connector reads and what the user is promised cannot drift apart — and
register it in `createConnector`. Ingestion, deduplication, encryption, citation,
and disconnection all come for free.

A test asserts that no connector's user-facing summary contains the words
"oauth", "scope", "token", "api", or "webhook".
