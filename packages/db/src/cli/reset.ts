import { rmSync } from 'node:fs';
import path from 'node:path';
import { getConfig, loadEnvFiles } from '@cairn/config';
import { openDatabase } from '../client';
import { migrate } from '../migrate';

loadEnvFiles();

/**
 * Destroys and recreates the local database.
 *
 * Refuses to run against a configured DATABASE_URL: dropping someone's hosted
 * database because they ran a convenience script is not an acceptable outcome.
 */
const config = getConfig();
if (config.env.DATABASE_URL) {
  process.stderr.write(
    'Refusing to reset: DATABASE_URL is set. This command only resets the local demo database.\n',
  );
  process.exit(1);
}

const dir = path.join(config.dataDir, 'pgdata');
rmSync(dir, { recursive: true, force: true });
process.stdout.write(`Removed ${dir}\n`);

const handle = await openDatabase();
await migrate(handle);
await handle.close();
process.stdout.write('Local database recreated.\n');
