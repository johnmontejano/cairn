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

Open **AI tools** in Cairn and choose the first tool you use. In hosted mode,
each card gives you one command or one remote address. The tool opens Cairn in
your browser, you approve the exact scopes, and the connection appears in the
same screen. Connection codes remain an advanced fallback for clients that do
not support browser sign-in.

The examples below use `https://your-deployment.example.com/api/mcp` as the
remote address. The live AI tools page fills in the right address for the
current deployment.

### Claude

In Claude, open **Customize → Connectors** (called **Settings → Connectors** in
some versions), add a custom connector, and paste:

```text
https://your-deployment.example.com/api/mcp
```

Team and Enterprise workspaces may require an owner to add the connector before
members can sign in.

### Claude Code

```bash
claude mcp add --transport http cairn --scope user \
  https://your-deployment.example.com/api/mcp
```

Start Claude Code, type `/mcp`, and complete the browser sign-in.

### Codex

```bash
codex mcp add cairn --url https://your-deployment.example.com/api/mcp
```

Restart Codex and type `/mcp` to authenticate and verify the connection. Codex
CLI, the Codex editor extension, and the Codex side of the ChatGPT desktop app
share the same MCP configuration on one host.

### ChatGPT

Ordinary ChatGPT web chat does not read local Codex MCP configuration. A remote
MCP-backed app requires a supported ChatGPT workspace/plan and may require an
administrator to enable developer mode. In that workspace, create an app from
**Settings → Apps**, paste the remote address, and choose browser sign-in.

If those controls are not present, connect the Codex side of the ChatGPT desktop
app instead. Cairn must label this path as plan-dependent rather than pretending
it works in every ChatGPT account.

### Connection codes

For a client that cannot open a browser, create a connection code under
**AI tools → Advanced setup**. It is shown once and stored only as a hash.
Running on the same machine is not treated as authorization: the code is what
scopes the caller to one workspace with one set of permissions.

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

## How tools share memory

Connected tools do not send private messages to one another. They coordinate
through one approved Cairn memory:

1. At the start of a conversation, the tool calls `whoami` once.
2. It calls `search_memory` before asking the person to repeat background.
3. When another tool may have continued the work, it calls
   `list_recent_changes` and searches the relevant project or decision.
4. If a durable fact, preference, or decision emerges and the connection has
   `memory:propose`, it calls `propose_memory_update`.
5. The proposal remains private until the person reviews and keeps it. Only then
   can the other connected tools retrieve it.

This is deliberate human-approved shared memory, not automatic transcript
surveillance and not direct LLM-to-LLM communication.

## The surface

### Resources

One per canonical document, each carrying its path, source memory version, and
the hash of the grant-filtered bytes actually returned:

```
cairn://memory/project_brief     cairn://memory/decision
cairn://memory/current_state     cairn://memory/next_step
cairn://memory/operating_rule    cairn://memory/fact
cairn://memory/preference        cairn://memory/person_org
```

### Tools

| Tool                                               | Scope            | Notes                                                                  |
| -------------------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| `whoami()`                                         | `memory:read`    | Approved identity and working context, filtered by the caller's grant  |
| `search_memory(query, project_id?, limit?)`        | `memory:read`    | Ranked results with full citations                                     |
| `get_memory_item(memory_item_id)`                  | `memory:read`    | Knowing the identifier is not enough; the same disclosure rule applies |
| `list_recent_changes(project_id?, since?, limit?)` | `memory:read`    | Versions with fingerprints                                             |
| `ask_deeply(question, project_id?)`                | `memory:read`    | Starts a cited, asynchronous synthesis                                 |
| `read_deep_answer(query_id)`                       | `memory:read`    | Reads the status or result of that synthesis                           |
| `setup_status()`                                   | `memory:read`    | Reports what setup is complete and what still needs attention          |
| `propose_memory_update(...)`                       | `memory:propose` | Creates a reviewable suggestion; never commits it directly             |

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
asserts that: no tool can directly write approved memory; results match what the
website's own search returns; sensitivity, visibility, project, and memory-type
grants apply to search, resources, identity, and deep answers; proposed and
removed memory is invisible; AI proposals carry evidence and become shared only
after human approval; every call is audited without memory text; and nothing
resembling a provider token appears in any response.

## Deliberate omissions

- No direct write tool. Approval happens in the website.
- Upstream connector tokens are never passed through MCP.
- A session identifier is never treated as authentication.
