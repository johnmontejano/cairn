# Unified Project Instructions

This repository uses portable project memory unified across Codex and Claude Code.

Before substantial work, read these files in order:

1. `memory/OPERATING_RULES.md`
2. `memory/PROJECT_BRIEF.md`
3. `memory/CURRENT_STATE.md`
4. `memory/DECISIONS.md`
5. `memory/NEXT_STEPS.md`

Treat tracked Markdown files under `memory/` as the unified source of truth,
ahead of previous conversations or tool-specific automatic memory.

After substantial work:

1. Update `memory/CURRENT_STATE.md` with the verified current state.
2. Add only durable, approved decisions to `memory/DECISIONS.md`.
3. Update `memory/NEXT_STEPS.md` so another agent can continue immediately.
4. Update `memory/PROJECT_BRIEF.md` only when the project scope changes.

Keep memory concise and factual. Clearly distinguish confirmed facts,
assumptions, decisions, open questions, and recommended actions. Never store
passwords, API keys, tokens, credentials, or sensitive personal/customer data
in project memory.

Preserve existing user-authored files and changes. Do not commit, push,
publish, deploy, or take consequential external actions unless the user asks.

## Agent Manager Reporting

Every agent task that performs work in this repository is tracked in Notion,
including short ones. The protocol applies to 5-minute, 20-minute, and
multi-hour tasks alike.

Locate the `Agent Manager` page and its `Agent Tasks` database through the
connected Notion workspace at run time. Never record its URL, ID, token, or any
credential in a tracked project file.

At the start of a task, create one `Agent Tasks` record for that task and set
`Task`, `Project`, `Platform`, `Started At`, `Last Updated`, and
`Status = Running`. Add `Task Link` when available. Set `Platform` to `Codex`
when working in Codex or Codex Cloud and `Claude Code` when working in Claude
Code. Update only the record for the current task.

Then keep that record accurate:

- `Needs Attention` — the user must make a decision, give approval, provide
  information, or grant access. Put the exact request in `User Action Needed`.
- `Blocked` — work cannot proceed. Explain why in `Handoff Summary`.
- `Completed` — the complete operation finished successfully. Add a concise
  outcome and verification summary to `Handoff Summary`.
- `Ready for Review` — use only when the task specifically requires user review
  or approval before it can be considered complete.
- `Paused` — only when the user explicitly pauses work.

Refresh `Last Updated` whenever status or handoff changes. If the Notion MCP is
unavailable, say so clearly in the final response rather than skipping silently.
