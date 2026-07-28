import { getServices } from '@cairn/ingestion';
import { handleMcpRequest } from '@cairn/mcp';

/**
 * The remote MCP endpoint.
 *
 * Authorization, rate limiting, and audit all live inside `handleMcpRequest`, so
 * this route stays a thin adapter and there is exactly one place where an MCP
 * request is allowed in.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(request: Request): Promise<Response> {
  const services = await getServices();
  return handleMcpRequest(request, services);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
