/** Stand-in Drive documents, used only when Google credentials are absent. */
export const DRIVE_FIXTURE_FILES = [
  {
    id: 'demo-drive-1',
    name: 'Supplier comparison.md',
    version: '3',
    body: `# Flour suppliers

We looked at three.

Whitmore Mills quoted £0.62 a kilo on a 12-month contract, delivery on Tuesdays.
Kessler quoted £0.58 but only deliver monthly, which means storage we do not have.
Fenwick would not quote without a site visit.

We decided to go with Whitmore Mills because weekly delivery matters more than
the four pence.
`,
  },
  {
    id: 'demo-drive-2',
    name: 'Opening hours draft.md',
    version: '1',
    body: `# Opening hours (draft)

Tuesday to Saturday, 7am to 2pm. Sunday 8am to 1pm. Closed Mondays.

Priya wants to start at 7 because the commuter trade is the only reliable
weekday income. Tom thinks 7am is optimistic for the first month.

This is not decided yet.
`,
  },
] as const;
