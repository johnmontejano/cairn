/** Stand-in repository files, used only when GitHub credentials are absent. */
export const GITHUB_FIXTURE_FILES = [
  {
    path: 'README.md',
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    body: `# demo-repo

A worked example of memory imported from a repository.

## Operating rules

Write decisions down when they are made, not afterwards.
Prefer the smallest change that solves the problem.
`,
  },
  {
    path: 'docs/decisions.md',
    sha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
    body: `# Decisions

We decided to keep everything in one repository rather than splitting it, because
the overhead of coordinating releases was not worth the isolation.

We decided that anything a person can read should be plain Markdown.
`,
  },
] as const;
