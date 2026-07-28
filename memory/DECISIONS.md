# Decision Log

## Template decision — Use portable repository memory

**Decision:** Keep durable unified context in tracked Markdown files under
`memory/`, with `AGENTS.md` and `CLAUDE.md` as agent entry points.

**Reasoning:** Codex and Claude Code can read the same repository files without
depending on proprietary chat history or tool-specific automatic memory.

Project-specific decisions should be added below with a date, decision, and
short reasoning.

## 2026-07-27 — Expand the template into an original shared-memory product

**Decision:** Build on the unified-memory idea to create an original product
with automatic ingestion, structured memory, search, citations,
synchronization, and MCP retrieval across AI tools.

**Reasoning:** The current template proves that portable Markdown can give
Codex and Claude Code the same authoritative project context, but it requires
manual upkeep and technical knowledge.

## 2026-07-27 — Make the website and nontechnical usability primary

**Decision:** The normal product experience must work through a simple UI for
people who are not coders and do not understand GitHub.

**Reasoning:** The current template is limited to technical users. The product's
main goal is to make shared AI context usable by anyone.

## 2026-07-27 — Preserve portable version-controlled Markdown

**Decision:** Retain human-readable, version-controlled Markdown as a core
product strength while adding automation and retrieval layers.

**Reasoning:** Portability, inspectability, and shared authority across AI tools
are the template's existing advantage and should not be lost.

## 2026-07-27 — Continue in the current project and use Claude Code to build

**Decision:** Plan and later implement the product in this existing project
folder, with Claude Code as the intended primary implementation agent.

**Reasoning:** Sharing the same folder preserves the unified-memory handoff and
avoids creating a separate project before the plan is approved.

## 2026-07-27 — Keep the product original

**Decision:** Use Unabyss as a public functional category reference, not as a
source for copied branding, copy, visual design, source code, or proprietary
implementation.

**Reasoning:** The goal is an original product with its own usability and
technical approach.

## 2026-07-27 — Prioritize data control and minimize external exposure

**Decision:** Treat privacy and control over plaintext memory as primary product
requirements, not secondary features.

**Reasoning:** The product may contain a person's broad memory and sensitive
context. Owning the code is insufficient if several managed infrastructure and
model providers still receive the plaintext, so the design must support
selective disclosure and local/private operation.

## 2026-07-27 — Require cloud-backed recoverability

**Decision:** Approved memory must have durable off-device persistence and a
tested restore path so loss of the user's computer does not destroy it.

**Reasoning:** A local-only canonical copy creates unacceptable data-loss risk.
The exact database, object store, encryption design, and backup provider may be
refined during implementation, but recoverability is not optional.

## 2026-07-27 — Begin from one comprehensive Claude Code prompt

**Decision:** Direct the initial build with one comprehensive prompt that tells
Claude Code to implement the full MVP through internal phases.

**Reasoning:** Claude Code should work autonomously across routine phases
without requiring a new prompt for each one. Consequential external actions,
including cloud-resource creation and deployment, still require explicit user
approval.
