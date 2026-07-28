import { loadEnvFiles } from '@cairn/config';
import { getServices } from '@cairn/ingestion';
import { clientsRepo, normalizeRows, withSystem } from '@cairn/db';
import { sql } from 'drizzle-orm';

loadEnvFiles();

const services = await getServices();
const token = await withSystem(services.handle, async (tx) => {
  const rows = normalizeRows<{ id: string; name: string }>(
    await tx.execute(
      sql`SELECT w.id, w.name FROM workspaces w
          JOIN users u ON u.id = w.owner_user_id
          WHERE u.email = 'demo@example.com' LIMIT 1`,
    ),
  );
  const ws = rows[0];
  if (!ws) throw new Error('No demo workspace. Run `pnpm demo:seed` first.');
  const { token } = await clientsRepo.createMcpClient(tx, {
    workspaceId: ws.id,
    name: 'Claude Code',
    scopes: ['memory:read'],
    projectIds: null,
    maxSensitivity: 'normal',
  });
  console.error(`workspace: ${ws.name}`);
  return token;
});
console.log(token);
process.exit(0);
