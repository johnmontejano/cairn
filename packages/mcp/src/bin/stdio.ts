#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig, loadEnvFiles } from '@cairn/config';
import { createServices } from '@cairn/ingestion';
import { McpAuthenticator } from '../auth';
import { createMcpServer } from '../server';

loadEnvFiles();

/**
 * Local stdio server.
 *
 * For clients that launch the server themselves (Claude Code, Codex) rather than
 * calling a URL. It still requires the connection code — running on the same
 * machine is not treated as authorization, because the code is what scopes the
 * caller to one workspace with one set of permissions.
 *
 * stdout belongs to the protocol; anything humans should see goes to stderr.
 */
const token = process.env.CAIRN_CONNECTION_CODE ?? getConfig().env.CAIRN_MCP_LOCAL_TOKEN ?? null;

if (!token) {
  process.stderr.write(
    'CAIRN_CONNECTION_CODE is not set.\n' +
      'Open Cairn → Settings → Connected AIs, create a connection, and copy the code.\n',
  );
  process.exit(1);
}

const services = await createServices();
const auth = await new McpAuthenticator(services.handle, services.config)
  .authenticate(token)
  .catch((error: Error) => {
    process.stderr.write(`Could not start: ${error.message}\n`);
    process.exit(1);
  });

const server = createMcpServer({
  services,
  actor: auth.actor,
  clientName: auth.clientName,
});

process.stderr.write(`Cairn memory ready for "${auth.clientName}" (${auth.scopes.join(', ')})\n`);
await server.connect(new StdioServerTransport());
