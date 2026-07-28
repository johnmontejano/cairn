import { getConfig, loadEnvFiles } from '@cairn/config';
import { openDatabase } from '../client';
import { migrate } from '../migrate';

loadEnvFiles();

const config = getConfig();
const handle = await openDatabase();
process.stdout.write(
  `Migrating ${handle.driver === 'pglite' ? `local database (${config.dataDir}/pgdata)` : 'Postgres'}\n`,
);
const result = await migrate(handle);
process.stdout.write(
  result.applied.length > 0
    ? `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}\n`
    : 'Database is already up to date.\n',
);
await handle.close();
