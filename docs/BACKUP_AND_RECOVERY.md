# Backup and recovery

The promise is narrow and testable: **losing your computer does not lose your
memory.** This document says how, and what the limits are.

## Two different artifacts

### A readable export — for keeping

**Settings → Download as readable files** produces a `.zip` of ordinary Markdown:
a README plus one file per kind of memory. No encryption, no passphrase, nothing
about it needs this product. Open it in any text editor.

Use this when you want your notes somewhere else, or want to stop using Cairn.
It cannot be used to restore history — it holds what you know, not the version
chain.

### An encrypted backup — for restoring

**Settings → Make a backup you can restore** produces one `.cairnbackup` file
containing the canonical documents, every memory item with its provenance, the
sources those citations point at, the version history, and the fingerprints
needed to prove it came back intact.

It is encrypted with a passphrase **you** choose, derived with scrypt. The server
never stores the passphrase or the archive — only its size and fingerprint. That
is what makes it independent of this deployment.

> If you lose the passphrase, the backup cannot be opened. Not by you, not by
> whoever runs the server. Write it down somewhere safe.

## Recovering after losing your computer

1. Get to a running Cairn — the hosted one you used, or a fresh local checkout
   (`pnpm install && pnpm setup && pnpm dev`).
2. Sign in, or sign up. A new account is fine; a backup does not need its
   original workspace.
3. **Settings → Restore from a backup**. Choose the file, enter the passphrase,
   and leave **"Just check it"** ticked.
4. Read the checks. Every one must pass:
   - the archive decrypts and its contents match the hash in its header;
   - every document matches its recorded fingerprint;
   - every saved memory still has at least one source;
   - the documents together reproduce the version fingerprint recorded when the
     backup was made.
5. Untick "Just check it" and restore.

Afterwards your memory is searchable again and every citation still resolves.

Restoring twice converges rather than duplicating.

## What the tests prove

`tests/integration/recovery.test.ts` runs the full round trip: build memory,
approve it, take a backup, then restore into a **different workspace with a
different encryption key** — the closest a test can get to a new computer and a
new account. It asserts that the restored documents hash to exactly the value
recorded before the backup was made, that every memory came back with working
evidence, and that search returns results again once the index is rebuilt.

It also asserts that an altered archive is refused, and that a backup whose
documents no longer match their fingerprints reports which ones.

## What a backup does not contain

Original source files. A backup of your memory should not also be a second copy
of every document you ever imported. Each citation keeps the excerpt it quotes,
so citations still read correctly after a restore; the full original does not
come back.

Export those separately if you need them.

## Automated backups

`backup.create` exists as a job type and `backups` records every archive's
fingerprint, size, and time. The scheduler that would run it on a timetable is
**not implemented** — backups today are the manual download. See
[the implementation status](IMPLEMENTATION_STATUS.md).

## No single copy is the only copy

- In demo mode the canonical memory is a local database file. That _is_ a single
  copy, and the interface should not be trusted as durable storage. Take a
  backup.
- In the documented deployment the canonical memory is in managed PostgreSQL with
  the provider's own backups, and the recovery artifact above is independent of
  it.

## Deleting

**Settings → Delete everything** removes memory, evidence, sources, versions,
stored documents and files, connections, connected AIs, audit history, usage
records, and finally the workspace key — so any leftover encrypted bytes become
unreadable. The report names each category and its count.

It cannot reach files you downloaded yourself, anything an AI tool already stored
in its own history, or your database provider's backups within their retention
window. The interface says all three.
