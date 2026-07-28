import {
  EXAMPLE_DOCUMENT,
  EXAMPLE_DOCUMENT_TITLE,
  EXAMPLE_FOLLOW_UP,
  EXAMPLE_FOLLOW_UP_TITLE,
} from '@cairn/connectors';
import { loadEnvFiles } from '@cairn/config';
import { migrate } from '@cairn/db/migrate';
import { Keyring, memoryRepo, withTenant, workspacesRepo } from '@cairn/db';
import { approveMemoryItem, createServices, drainJobs, submitSource } from '@cairn/ingestion';

loadEnvFiles();

/**
 * Seeds the demo account.
 *
 * Uses the same entry points the website uses, so what a person sees after
 * running this is exactly what they would have got by pasting the documents
 * themselves — including the one contradiction, left unresolved on purpose so the
 * conflict screen has something real to show.
 */
const email = process.argv[2] ?? 'demo@example.com';
const services = await createServices();
await migrate(services.handle, { silent: true });

const keyring = new Keyring(services.handle);
const { user, workspace, project, created } = await workspacesRepo.provisionUser(
  services.handle,
  keyring,
  { email, displayName: 'Demo Person', externalId: null, authProvider: 'fixture' },
);
const actor = { userId: user.id, workspaceId: workspace.id, role: 'owner' as const };

process.stdout.write(
  `${created ? 'Created' : 'Reusing'} demo account for ${email}\n  workspace: ${workspace.name}\n  project:   ${project.name}\n\n`,
);

for (const [title, body] of [
  [EXAMPLE_DOCUMENT_TITLE, EXAMPLE_DOCUMENT],
  [EXAMPLE_FOLLOW_UP_TITLE, EXAMPLE_FOLLOW_UP],
] as const) {
  const result = await submitSource(services, {
    actor,
    projectId: project.id,
    provider: 'paste',
    externalId: `example:${title}`,
    title,
    mimeType: 'text/markdown',
    bytes: new TextEncoder().encode(body),
  });
  process.stdout.write(`  ${result.deduplicated ? 'already had' : 'added'}: ${title}\n`);
}

const drained = await drainJobs(services, { maxRounds: 40 });
process.stdout.write(`\nProcessed ${drained.processed} background job(s).\n`);

const crypto = await keyring.get(workspace.id);
const proposals = await withTenant(services.handle, actor, (tx) =>
  memoryRepo.listMemoryItems(tx, crypto, {
    workspaceId: workspace.id,
    projectId: project.id,
    statuses: ['proposed'],
  }),
);

// Approve the decisions and rules, and leave everything else waiting for review
// so the first screen a person sees has something to do.
let approved = 0;
for (const proposal of proposals) {
  if (!['decision', 'operating_rule'].includes(proposal.type)) continue;
  await approveMemoryItem(services, actor, {
    memoryItemId: proposal.id,
    projectId: project.id,
    authorLabel: 'Demo Person',
  });
  approved += 1;
}

process.stdout.write(
  `\nFound ${proposals.length} things worth remembering.\n` +
    `Kept ${approved} automatically; the rest are waiting for review.\n\n` +
    `Sign in at http://localhost:3000 as ${email}.\n` +
    `The sign-in code is printed by the server, not emailed.\n`,
);

await services.handle.close();
