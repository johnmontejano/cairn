# Connecting an AI tool

Cairn speaks the Model Context Protocol, so a tool you already use can look up
what you have saved instead of making you repeat it.

Protocol revision **2025-11-25** — the latest stable one, deliberately not a
release candidate. Built on the official TypeScript SDK, pinned at `1.30.0`.

## What a connected tool can and cannot do

It **can** search your saved memory, open one item and its citations, list what
changed recently, read the canonical documents, and — only if you allow it —
suggest something new.

It **cannot** see anything waiting for your review, anything you removed,
anything marked never-share, anything above the sensitivity ceiling you set, or
any project you did not grant. It cannot change or delete memory. `memory:write`
is reserved for a future release and cannot be granted by the interface.

Every call is recorded in your History, attributed to the tool rather than to
you, with no memory text in the record.

## Connecting

Open **Settings → Connected AIs**, create a connection, and copy the code. It is
shown once and stored only as a hash.

### Claude Code

```bash
claude mcp add cairn \
  --env CAIRN_CONNECTION_CODE=your-code-here \
  -- npx -y tsx /absolute/path/to/this/project/packages/mcp/src/bin/stdio.ts
```

### Codex, or anything that reads a configuration file

```json
{
  "mcpServers": {
    "cairn": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/this/project/packages/mcp/src/bin/stdio.ts"],
      "env": { "CAIRN_CONNECTION_CODE": "your-code-here" }
    }
  }
}
```

Running on the same machine is not treated as authorization: the connection code
is what scopes the caller to one workspace with one set of permissions.

### Remote

```
POST https://your-deployment.example.com/api/mcp
Authorization: Bearer <connection code, or an OAuth 2.1 access token>
```

Streamable HTTP, stateless — a fresh server per request, so no session state can
be mistaken for authentication. With `MCP_AUTH_MODE=oauth`, tokens are verified
for signature, issuer, **audience**, and expiry, and the effective scopes are the
intersection of the token's and the grant's. A token minted for a different
resource is rejected even when its signature is valid.

## The surface

### Resources

One per canonical document, each carrying its path, version, and manifest hash:

```
cairn://memory/project_brief     cairn://memory/decision
cairn://memory/current_state     cairn://memory/next_step
cairn://memory/operating_rule    cairn://memory/fact
cairn://memory/preference        cairn://memory/person_org
```

### Tools

| Tool                                               | Scope            | Notes                                                                  |
| -------------------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| `search_memory(query, project_id?, limit?)`        | `memory:read`    | Ranked results with full citations                                     |
| `get_memory_item(memory_item_id)`                  | `memory:read`    | Knowing the identifier is not enough; the same disclosure rule applies |
| `list_recent_changes(project_id?, since?, limit?)` | `memory:read`    | Versions with fingerprints                                             |
| `propose_memory_update(...)`                       | `memory:propose` | Creates a suggestion awaiting review; returns `committed: false`       |

### What a citation contains

```json
{
  "memory_item_id": "…",
  "memory_version_id": "…",
  "canonical_path": "memory/DECISIONS.md",
  "source": {
    "provider": "paste",
    "item_id": "…",
    "title": "Notes from the bakery planning meeting",
    "revision_id": "…",
    "locator": "Section: What we decided",
    "imported_at": "2026-07-28T…"
  },
  "excerpt": "We decided to sign the Mill Street lease…",
  "offsets": { "start": 512, "end": 604 }
}
```

Every result is traceable to the exact source version and the exact characters.

## Guarantees the tests hold

`pnpm test:mcp` drives a real MCP client over the SDK's in-process transport and
asserts that: the tool list contains nothing that writes; results match what the
website's own search returns; sensitive and never-share memory is withheld;
proposed and removed memory is invisible; a tool without a scope is refused; a
proposal is never committed; every call is audited without memory text; and
nothing resembling a provider token appears in any response.

## Deliberate omissions

- No write tool. Approval happens in the website.
- Upstream connector tokens are never passed through MCP.
- A session identifier is never treated as authentication.
