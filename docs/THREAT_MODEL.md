# Threat model

What this design protects against, and — more importantly — what it does not.
Nothing here is a compliance claim.

## What is being protected

A person's accumulated context: project notes, decisions, who is involved, how
they like things done. It is not usually catastrophic on its own, and it is
frequently embarrassing, commercially sensitive, or personal in aggregate. The
aggregate is the point: this product deliberately concentrates it.

## Assets

| Asset                    | Where it lives                  | How it is protected                                 |
| ------------------------ | ------------------------------- | --------------------------------------------------- |
| Memory titles and values | `memory_items`, encrypted       | AES-256-GCM under a per-workspace key               |
| Evidence excerpts        | `memory_evidence`, encrypted    | same, plus an immutability trigger                  |
| Raw source snapshots     | object store, encrypted         | encrypted before leaving the process                |
| Normalized source text   | `source_revisions`, encrypted   | same                                                |
| Chunk text               | `chunks`, encrypted             | same                                                |
| Canonical Markdown       | `vault_objects`, encrypted      | content-addressed; update blocked by trigger        |
| Connector credentials    | `source_connections`, encrypted | separate derived key; destroyed on disconnect       |
| Workspace data key       | `workspace_keys`, wrapped       | unwrappable only with the deployment key            |
| Session tokens           | `sessions`                      | stored as SHA-256; the token itself is never stored |
| AI connection codes      | `mcp_clients`                   | stored as SHA-256; shown once                       |

## Trust boundaries

```
browser │ website process │ database │ object store │ model provider │ AI client
        └── session ──────┘          └── ciphertext ┘└─ plaintext ───┘└ plaintext ┘
```

The website process is the trusted core. It holds the deployment key, unwraps
workspace keys, and sees plaintext. Everything outside it either receives
ciphertext or receives a deliberately narrowed slice.

## What the design defends against

**A stolen database.** Memory, evidence, sources, chunks, canonical documents,
and connector credentials are all ciphertext. The key that opens them is not in
the database. A dump alone yields metadata: identifiers, timestamps, types,
statuses, sensitivity labels, topic tags, content hashes, and the _shape_ of a
workspace.

**A stolen backup file.** Backups are encrypted with a passphrase the person
chooses, derived with scrypt. The server never stores the passphrase or the
archive — only its size and fingerprint.

**Cross-tenant access.** Row-level security is enforced by the database against a
role that does not own the tables, so it holds even when application code is
wrong. Ciphertext is additionally bound to `workspace | purpose | row id` as
associated data, so a ciphertext moved between rows or tenants fails to decrypt
rather than silently succeeding. Tests attack all three layers.

**A leaked AI connection code.** It is workspace-scoped, carries only the scopes
granted, cannot reach sensitive or never-share memory unless explicitly allowed,
cannot see anything unapproved, and cannot write. Revocation takes effect on the
next request. Every call is audited.

**Prompt injection from imported content.** Source text is data. It is fenced and
labelled untrusted in every model prompt, and — the part that actually matters —
model output is schema-validated and every claimed evidence span is re-verified
against the real document. A candidate whose quoted excerpt is not in the source
is discarded rather than shown.

**A confidently wrong answer.** An answer may only contain statements that map to
retrieved evidence. The model-backed answerer discards statements whose citations
do not resolve, so ignoring the instruction produces a shorter answer, never an
unsupported one. "There is not enough saved about that" is a normal outcome.

**Request forgery through URL import.** Every hop is checked, including
redirects: private, loopback, link-local, and carrier-grade-NAT ranges are
refused, as are non-HTTPS schemes and service ports.

**Cross-site request forgery.** Origin checking plus a double-submit token on
every mutation.

**Secrets in logs.** Redaction happens at the logging boundary, not at call
sites. Keys matching credential patterns become `[redacted]`; content fields are
reduced to a character count. Audit metadata is redacted the same way. Tests
assert that neither contains memory text or tokens.

**Silent overwrites.** Contradictions are preserved and flagged, never resolved
by last-write-wins. Explicit human intent outranks passive extraction; two
assertions of equal authority go to a person.

## What the design does NOT defend against

**Anyone who controls the running server.** This is not end-to-end encryption.
The server holds the deployment key and unwraps workspace keys to do its work. An
attacker with code execution, or an operator who chooses to, can read everything
being processed. If that is unacceptable, run it yourself with a local model.

**A compromised deployment key.** It unwraps every workspace key. Keep it in a
secret manager, not in the database, not in the repository, not in a log. Use the
KMS provider in production so the process never holds the master key itself.

**Traffic analysis and metadata.** Plaintext metadata is a deliberate trade:

- **Topic tags are stored in plaintext.** They are needed for filtering, and they
  disclose subject matter.
- Timestamps, item counts, types, statuses, and sensitivity labels are plaintext.
- Content hashes let an attacker confirm a _guessed_ document, not read one.

**Embedding inversion.** Embeddings are stored unencrypted because pgvector must
compare them. Published research shows embeddings can be partially inverted to
recover approximate source text. **Treat the embedding table as sensitive: it is
the weakest link in the at-rest story.** Do not replicate it somewhere the
encrypted tables are not.

**Blind-index frequency analysis.** Term hashes are per-workspace and
irreversible, but their _frequency distribution_ is visible and leaks something
about vocabulary. It is a deliberate trade against storing a plaintext corpus.

**What an AI client does next.** Once memory is delivered to a connected tool,
that tool's terms apply. The interface says so before anything is connected.

**A hostile source provider.** A connected provider can feed misleading content.
It becomes reviewable proposals, not saved memory.

**Denial of service.** Rate limits are per-key and single-region. This has not
been load-tested.

## Explicitly not claimed

- Not end-to-end encrypted.
- Not zero-knowledge.
- No SOC 2, ISO 27001, HIPAA, or GDPR compliance claim.
- No zero-retention claim for any external model provider. The OpenAI adapter
  sends `store: false`, which is not the same as zero retention; abuse-monitoring
  retention is the provider's policy, not ours.
- No independent security review has been performed.

## Residual risks worth deciding about before launch

1. The embedding table is the weakest at-rest surface. Consider encrypting
   embeddings and accepting exact search, or isolating that table.
2. Key rotation currently re-wraps the data key. Rotating the _data_ key requires
   re-encrypting every row; the interface exists, the migration job does not.
3. The remote MCP OAuth path has not been exercised against a live issuer.
4. Deletion is immediate and honest within this deployment, but a hosted database
   provider's own backups may retain rows for their retention window. State that
   period in your privacy policy.
