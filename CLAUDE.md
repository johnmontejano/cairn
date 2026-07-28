@AGENTS.md

# Claude Code

Use the repository's tracked `memory/` files as the unified context for Codex
and Claude Code. Tool-specific automatic memory may supplement them but must not
replace or contradict them.

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
