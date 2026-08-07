# Scheduled sync

Until this existed, every connector in the product said "nothing runs on its
own", and that was accurate: a connection was only ever re-read when someone
pressed **Check for updates**. A memory product whose memory only updates when
you remember to update it has a chore attached to it. This is the part that
runs without anyone present.

## What it does

`GET /api/cron/sync` walks every connection across every workspace whose state
is `active` or `ready` and which has no `disconnectedAt`, and enqueues one
`connection.sync` job for each. That is the same job the **Check for updates**
button enqueues — deliberately, so the scheduled path and the manual path
cannot drift apart and start behaving differently.

Where the web process owns the queue (`CAIRN_INLINE_JOBS`), the request also
drains what it can before returning. Anything left queued is picked up by the
next run or by a worker, so a timeout costs latency and never work.

### What it skips, and why

| Skipped                           | Reason                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `demo` connections                | Fixtures. There is nothing real to read.                                                                                                               |
| `state = 'disconnected'`          | Already torn down.                                                                                                                                     |
| Any row with `disconnectedAt` set | **The one that matters.** A row can still read `active` while being disconnected; syncing it would mean using a permission its owner already withdrew. |

## Turning it on

Set **`CRON_SECRET`** on the deployment. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

On Vercel, adding a `CRON_SECRET` project environment variable is enough — Cron
sends it as `Authorization: Bearer …` automatically. The schedule itself lives
in `vercel.json`.

Until that variable is set the endpoint refuses **every** caller, and
`/sources` keeps telling people that nothing runs on its own. That default is
deliberate in both directions: an unauthenticated endpoint that enqueues work
for every tenant is worse than one that never runs, and claiming an automatic
refresh that no scheduler performs is the worse of the two available lies.

## The Hobby-plan limit, which is a real constraint

Vercel's Hobby plan **rejects any cron that would run more than once per day**,
and a deployment carrying one does not fail softly — the build fails outright
with:

> Hobby accounts are limited to daily cron jobs. This cron expression
> (`0 */6 * * *`) would run more than once per day.

So `vercel.json` ships `0 13 * * *` — once daily, 13:00 UTC, which is early
morning in California, so a day's reading is waiting rather than landing
mid-use. If you shorten that interval on a Hobby account, **the next push will
stop deploying entirely**, and the symptom is confusing: the site keeps serving
the previous deployment, so it looks like nothing happened rather than like a
failure.

Three ways out, in ascending order of effort:

1. **Leave it daily.** Fine if a day-old memory is acceptable.
2. **Drive it externally.** Anything that can make an HTTP request on a
   schedule works — a GitHub Actions workflow, cron-job.org, a machine you
   already run. The endpoint is idempotent per hour, so calling it more often
   than hourly is safe and simply collapses. This is free and unlocks any
   interval.
3. **Move the project to Pro** and shorten the expression.

### Driving it from GitHub Actions

Put the secret in the repository's Actions secrets — safe even in a public
repository, since Actions secrets are not exposed to forks or logs.

```yaml
name: Refresh Cairn memory
on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl --fail --silent --show-error \
            -H "Authorization: Bearer $CRON_SECRET" \
            https://cairn-web-beta.vercel.app/api/cron/sync
        env:
          CRON_SECRET: ${{ secrets.CAIRN_CRON_SECRET }}
```

## Checking it works

```bash
# Refused without the secret, in every environment.
curl -i https://your-app.example.com/api/cron/sync

# A run, with it.
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.example.com/api/cron/sync
```

A successful run answers with what it did:

```json
{
  "ok": true,
  "connections": 2,
  "enqueued": 2,
  "alreadyQueued": 0,
  "failed": 0,
  "drained": true,
  "durationMs": 214
}
```

`alreadyQueued` counts connections whose job for this hour already existed.
Two runs inside the same hour collapse to one sync — the button uses a
minute-scale key and so is never blocked by a scheduled run.

## Tests

`tests/integration/scheduled-sync.test.ts` covers which connections are
selected (including the still-`active`-but-disconnected row), that a second run
in the same bucket collapses, and that the next bucket runs again.
