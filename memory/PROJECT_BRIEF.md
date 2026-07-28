# Project Brief

Status: Initialized for product planning on 2026-07-27

Working product name: To be decided

## Purpose

Expand the Codex + Claude Code unified-memory template into an original
web-based product that lets multiple AI tools retrieve the same relevant,
current project context.

Preserve the template's portable, human-readable, version-controlled Markdown
memory while adding automatic ingestion, structured memory, search, citations,
synchronization, and an MCP server.

## Intended users

- People who use one or more AI tools and repeatedly provide the same context.
- The primary usability audience includes people with no coding, GitHub, Git,
  or MCP experience.
- Developers remain supported as advanced users, but they are not the only
  audience.

## Desired outcomes

- A person can use a simple website to add or connect information and understand
  what the product remembers.
- Retrieved context and answers are traceable to their sources.
- Authorized AI tools can retrieve the same relevant memory.
- Memory remains portable and reviewable rather than locked inside one AI
  vendor.
- Technical concepts are hidden from the normal user journey.

## Scope

- Product planning, architecture, and a phased implementation plan in this
  existing project folder.
- A web UI as the primary customer experience.
- Ingestion, structured memory, provenance, search, citations,
  synchronization, export, and MCP delivery.
- Durable cloud-backed persistence and tested recovery so losing a computer
  does not destroy the user's memory.
- A narrow first release and one end-to-end tracer before adding broad
  integrations.

## Non-goals

- Requiring users to understand or use GitHub.
- Copying Unabyss branding, copy, visual identity, source code, or proprietary
  implementation.
- Building every public Unabyss integration in the first release.
- Implementing the product during the current research and planning phase.

## Constraints

- Continue from the current unified-memory-template folder.
- Claude Code is the intended primary implementation agent.
- Preserve the existing unified-memory convention and concise factual handoff
  files.
- The normal website flow must be usable without GitHub or technical
  vocabulary.
- Data control and privacy are primary product requirements. The architecture
  must minimize which third parties receive plaintext memory and support a
  genuinely local/private operating mode.
- A computer-local copy must not be the only canonical copy of user memory.
- Do not invent security, compliance, privacy, freshness, or accuracy
  guarantees.
- No repository creation, GitHub changes, commits, pushes, deployment, or
  product implementation has been authorized yet.

## Success criteria

- A nontechnical person can add or connect one source, see what was learned,
  correct it, and receive a cited answer without coaching.
- The same approved context can be retrieved by at least one authorized AI
  client without the user needing to understand MCP.
- Each memory item and factual answer can reveal its exact evidence and memory
  revision.
- Users can export their memory as readable Markdown.
- Users can restore their approved memory after losing the original computer.
- GitHub is optional and advanced, not an onboarding dependency.
- Users can understand where their data is stored, which processor receives it,
  and what disconnecting or deleting removes.
