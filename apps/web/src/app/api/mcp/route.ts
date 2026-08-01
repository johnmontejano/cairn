import { getServices } from '@cairn/ingestion';
import { handleMcpRequest } from '@cairn/mcp';
import { drainQueuedWork } from '@/server/context';

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
  const response = await handleMcpRequest(request, services);

  // On a worker-less deployment the web process is the only thing that runs
  // jobs, and until now only web actions drained the queue. MCP tools enqueue
  // too — ask_deeply in particular — so without this, a deep query asked from a
  // connected AI would sit queued until someone unrelated visited the website.
  // Awaited rather than fired and forgotten because serverless freezes the
  // process once the response goes out. Costs one cheap claim query when the
  // queue is empty.
  await drainQueuedWork(services);

  return response;
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
