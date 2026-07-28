import { getConfig } from '@cairn/config';
import type { ErrorReporter, LogLevel, Logger } from '@cairn/domain';

/**
 * Structured logging with redaction built in.
 *
 * The redaction happens here rather than at call sites, because the failure mode
 * being prevented — a decrypted memory value or an access token reaching a log
 * aggregator — is caused precisely by a call site that did not think about it.
 */

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /(token|secret|password|passphrase|key|authorization|cookie|credential)/i;
const CONTENT_KEY = /^(value|content|text|excerpt|body|title|query|question|prompt|answer)$/i;

export function redactLogFields(
  fields: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 3) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (CONTENT_KEY.test(key)) {
      // Length is diagnostic; the text itself never is.
      out[key] = typeof value === 'string' ? `[${value.length} chars]` : '[redacted]';
      continue;
    }
    if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message.slice(0, 300) };
    } else if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.length > 300 ? `${value.slice(0, 300)}…` : value;
    } else if (Array.isArray(value)) {
      out[key] = value.length;
    } else if (typeof value === 'object') {
      out[key] = redactLogFields(value as Record<string, unknown>, depth + 1);
    }
  }
  return out;
}

export class JsonLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly bindings: Record<string, unknown> = {},
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {}

  child(bindings: Record<string, unknown>): Logger {
    return new JsonLogger(
      this.minLevel,
      { ...this.bindings, ...redactLogFields(bindings) },
      this.sink,
    );
  }

  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    this.sink(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        message,
        ...this.bindings,
        ...redactLogFields(fields),
      }),
    );
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log('debug', message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.log('info', message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.log('warn', message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.log('error', message, fields);
  }
}

export function createLogger(config = getConfig()): Logger {
  return new JsonLogger(config.env.LOG_LEVEL, { service: 'cairn' });
}

export const noopErrorReporter: ErrorReporter = {
  kind: 'noop',
  captureException() {},
};

/**
 * Sentry over its plain HTTP envelope endpoint.
 *
 * Deliberately no SDK: the SDK's default integrations capture request bodies and
 * breadcrumbs, which is exactly the data this product must not send anywhere.
 * Only the exception type, message, and explicitly-passed tags leave the process.
 */
export class SentryErrorReporter implements ErrorReporter {
  readonly kind = 'sentry' as const;

  constructor(
    private readonly dsn: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly logger: Logger = createLogger(),
  ) {}

  captureException(error: unknown, context: Record<string, unknown> = {}): void {
    void this.send(error, context).catch(() => {
      /* never let error reporting cause an error */
    });
  }

  private async send(error: unknown, context: Record<string, unknown>): Promise<void> {
    const parsed = parseDsn(this.dsn);
    if (!parsed) return;
    const err = error instanceof Error ? error : new Error(String(error));
    const event = {
      event_id: globalThis.crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: 'error',
      exception: { values: [{ type: err.name, value: err.message.slice(0, 500) }] },
      tags: redactLogFields(context),
    };
    const envelope = [
      JSON.stringify({ event_id: event.event_id, dsn: this.dsn }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');

    const res = await this.fetchImpl(parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=cairn/0.1`,
      },
      body: envelope,
    });
    if (!res.ok) this.logger.warn('sentry.rejected', { status: res.status });
  }
}

function parseDsn(dsn: string): { envelopeUrl: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    return {
      publicKey: url.username,
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

export function createErrorReporter(config = getConfig()): ErrorReporter {
  return config.env.SENTRY_DSN ? new SentryErrorReporter(config.env.SENTRY_DSN) : noopErrorReporter;
}
