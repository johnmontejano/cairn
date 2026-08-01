# Privacy Policy — Cairn

**DRAFT — not yet published.** Filled in using the recommended choice from
`docs/RETENTION_DECISIONS.md` everywhere a decision was needed. Two blanks are
left because they are not mine to fill in: your name/entity, and a contact
address. Fill those two, then this is ready to publish.

Last updated: 2026-08-01
Operator: Cairn (John M.), reachable at johnmontejano2@gmail.com

---

Cairn stores things you want your AI tools to remember, so you stop explaining
yourself over and over. This policy says exactly what it holds, who else can see
it, and what you can remove.

It is written to be read. Where something is a genuine weakness, it is named
rather than phrased around.

## What Cairn holds

**Things you chose to save.** Every memory reaches Cairn as a proposal and is
saved only after you keep it. Nothing is saved from a source without you
reviewing it first.

**The documents those memories came from.** Cairn keeps the original text so
that every answer can show the exact sentence it came from. These are encrypted
before they are written to disk.

**Your email address**, to sign you in.

**Records of activity** — that a memory was approved, a source connected, an AI
tool granted access. These hold no memory content.

**Nothing else.** Cairn has no advertising, no analytics of your content, and no
tracking across other sites.

## Who else receives it

Cairn is not a single company holding your data alone. Each service below
receives a specific slice.

| Who                                     | What they receive                             | Can they read your text?                 |
| --------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| **Vercel** (hosting)                    | Every request while it is being handled       | Yes — this is where Cairn itself runs    |
| **Supabase** (database, US East)        | Encrypted memory and documents, plus metadata | **No**, except the items named below     |
| **Supabase Storage**                    | Encrypted copies of original documents        | No                                       |
| **WorkOS** (sign-in)                    | Your email address and name                   | Identity only — never your memory        |
| **Google** (Gmail, Calendar, Drive)     | Only a request for what you connected         | It is their data already; Cairn reads it |
| _(none — no external AI model is used)_ | —                                             | —                                        |
| **Sentry** (errors, optional)           | Error type and message                        | No content                               |
| **AI tools you connect**                | Only the memory they look up, with citations  | Yes — see below                          |

### If an AI model is turned on

This deployment runs with no external model at all: extraction, search, and
answering all happen inside the application. No document text, memory text, or
question you ask ever leaves this service to reach any AI provider.

If that ever changes, this section will be updated first, and the table above
will name exactly who receives what.

### AI tools you connect

When you connect Claude, Cursor, ChatGPT, or another tool, it can look things up
in the memory you have saved. What it retrieves goes to that company, and from
that moment **their** terms apply to it, not this policy. That is true of every
AI tool, and it is why nothing is shared until you decide.

A connected tool can never change or delete your memory, and can never see
anything still waiting for your review. You can turn any connection off at any
time, and it stops working immediately.

## What is not encrypted, and why

Your memory and documents are encrypted before they are stored. Some things
cannot be, because a feature depends on reading them:

- **Topic tags, types, and dates** — filtering and sorting need them. These
  disclose subject matter and when you were active.
- **Document titles and web addresses** — a citation you cannot read is not a
  citation.
- **Search embeddings** — the numeric representations used to find relevant
  memory. These are stored unencrypted because the search index must compare
  them, and they are **partially reversible**: someone with direct access to the
  database could recover an approximation of your memory's meaning from them.
  This is the weakest point in the design and it is named here deliberately
  rather than left out.

## Google user data

Cairn's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

Specifically:

- Gmail and Calendar data is read **only** to propose memories for you to review.
- It is **never** sold, and never transferred to anyone except as necessary to
  provide the feature you asked for.
- It is **never** used for advertising.
- It is **not** used to train any general-purpose AI model.
- No human reads it, except where you explicitly ask for support and grant
  access, or where the law requires it.

Disconnecting Google in Cairn destroys the stored credential immediately. You
can also revoke access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## How long it is kept

| What                 | Kept for                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| Memory you saved     | Until you delete it                                                         |
| Original documents   | 90 days, then the original is dropped — only the memory it produced remains |
| Activity records     | 12 months, then removed                                                     |
| Sign-in sessions     | 30 days, or until you sign out                                              |
| Source credentials   | Destroyed the moment you disconnect                                         |
| Backups you download | Only by you — Cairn never keeps them                                        |

## What you can do

**Export everything**, as ordinary Markdown files, in one click. No request, no
waiting.

**Download an encrypted backup**, locked with a passphrase only you know.
Cairn cannot open it. If you lose the passphrase, nobody can.

**Delete everything.** Deleting your workspace removes memory, documents,
sources, connections, connected AI tools, activity records, and finally the key
that everything was encrypted with. You get a report naming each category and
how many rows were removed.

Deletion is **immediate**. There is no grace period and no undo. If you want a
copy first, download a backup or export before deleting.

Three things deletion honestly cannot reach, and Cairn says so rather than
implying otherwise:

- Files you exported or downloaded yourself.
- Anything an AI tool already stored in its own history.
- The database provider's own backups, for their retention window.

## What Cairn does not claim

Cairn has had **no independent security review**. It has no certification, no
SOC 2 report, and no compliance audit. The design is documented in the open —
see the threat model and privacy matrix — precisely so the claims can be checked
rather than taken on trust.

If that is not enough assurance for the data you were thinking of putting in, do
not put it in yet. That is a reasonable decision and this policy would rather
say so than talk you past it.

## Changes, and getting in touch

Material changes will be shown in the app before they take effect, not published
quietly.

Questions or deletion requests: johnmontejano2@gmail.com. Google's review requires
this to be a real, reachable address.
