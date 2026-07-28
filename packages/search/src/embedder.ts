import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS, getConfig } from '@cairn/config';
import { SetupRequiredError, type Embedder, type EmbeddingUsage } from '@cairn/domain';

/** Published rate for `text-embedding-3-small`, used only to estimate spend. */
const OPENAI_EMBEDDING_USD_PER_MTOK = 0.02;

/** Rough token estimate. Deliberately conservative so budgets bind early. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/* ------------------------------------------------------------------ *
 * Fixture: deterministic, local, free
 * ------------------------------------------------------------------ */

function hashToBucket(token: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${token}`).digest();
  return digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
}

function tokenize(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && t.length <= 40);
}

/**
 * Deterministic embeddings with no network call.
 *
 * Terms and character trigrams are hashed into the same vector space with
 * sub-linear term weighting, then L2-normalized, so cosine similarity behaves like
 * a smoothed weighted term overlap. It is not a language model — it will not match
 * "car" to "automobile" — but it is stable, free, private, and good enough that
 * the demo experience is genuinely useful rather than a stub.
 */
export class FixtureEmbedder implements Embedder {
  readonly kind = 'fixture' as const;
  readonly modelLabel = 'built-in-deterministic-v1';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: EmbeddingUsage }> {
    return {
      vectors: texts.map((t) => this.embedOne(t)),
      usage: {
        model: this.modelLabel,
        inputTokens: texts.reduce((n, t) => n + estimateTokens(t), 0),
        estimatedCostUsd: 0,
        cached: false,
      },
    };
  }

  embedOne(text: string): number[] {
    const vector = new Float64Array(EMBEDDING_DIMENSIONS);
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    const add = (bucket: number, amount: number) => {
      vector[bucket] = (vector[bucket] ?? 0) + amount;
    };
    for (const [token, count] of counts) {
      const weight = 1 + Math.log(count);
      add(hashToBucket(token, 'term'), weight);
      // Trigrams add partial credit for near-misses and typos.
      for (let i = 0; i + 3 <= token.length; i += 1) {
        add(hashToBucket(token.slice(i, i + 3), 'gram'), weight * 0.35);
      }
    }

    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm === 0) return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    return Array.from(vector, (value) => value / norm);
  }
}

/* ------------------------------------------------------------------ *
 * OpenAI-compatible: hosted or local
 * ------------------------------------------------------------------ */

interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * Talks to any OpenAI-compatible `/embeddings` endpoint.
 *
 * The same class serves the hosted API and a local model server, because the only
 * differences are the base URL, the model name, and whether an API key is needed.
 * That is exactly the property that lets someone move to fully local operation
 * without the domain layer changing.
 */
export class OpenAiCompatibleEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    readonly kind: 'openai' | 'local',
    private readonly options: {
      baseUrl: string;
      apiKey?: string;
      model: string;
      usdPerMillionTokens: number;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get modelLabel(): string {
    return this.options.model;
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: EmbeddingUsage }> {
    if (texts.length === 0) {
      return {
        vectors: [],
        usage: { model: this.modelLabel, inputTokens: 0, estimatedCostUsd: 0, cached: false },
      };
    }
    const res = await this.fetchImpl(`${this.options.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) {
      throw new Error(`Embedding request failed (${res.status}): ${await safeText(res)}`);
    }
    const body = (await res.json()) as OpenAiEmbeddingResponse;
    const ordered = [...body.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding model returned ${item.embedding.length} dimensions; this database stores ${EMBEDDING_DIMENSIONS}.`,
        );
      }
    }
    const inputTokens =
      body.usage?.prompt_tokens ??
      body.usage?.total_tokens ??
      texts.reduce((n, t) => n + estimateTokens(t), 0);
    return {
      vectors: ordered.map((d) => d.embedding),
      usage: {
        model: this.modelLabel,
        inputTokens,
        estimatedCostUsd: (inputTokens / 1_000_000) * this.options.usdPerMillionTokens,
        cached: false,
      },
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}

/**
 * Caches by content hash so unchanged text is never re-embedded — the single
 * biggest lever on both latency and spend during re-ingestion.
 */
export class CachingEmbedder implements Embedder {
  private readonly cache = new Map<string, number[]>();

  constructor(
    private readonly inner: Embedder,
    private readonly maxEntries = 5000,
  ) {}

  get kind(): Embedder['kind'] {
    return this.inner.kind;
  }
  get modelLabel(): string {
    return this.inner.modelLabel;
  }
  get dimensions(): number {
    return this.inner.dimensions;
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: EmbeddingUsage }> {
    const keys = texts.map((t) => createHash('sha256').update(t).digest('base64'));
    const missingIndexes = keys.flatMap((k, i) => (this.cache.has(k) ? [] : [i]));
    let usage: EmbeddingUsage = {
      model: this.modelLabel,
      inputTokens: 0,
      estimatedCostUsd: 0,
      cached: true,
    };

    if (missingIndexes.length > 0) {
      const fresh = await this.inner.embed(missingIndexes.map((i) => texts[i]!));
      usage = { ...fresh.usage, cached: false };
      missingIndexes.forEach((textIndex, n) => {
        const key = keys[textIndex]!;
        if (this.cache.size >= this.maxEntries) {
          const oldest = this.cache.keys().next().value;
          if (oldest) this.cache.delete(oldest);
        }
        this.cache.set(key, fresh.vectors[n]!);
      });
    }
    return { vectors: keys.map((k) => this.cache.get(k)!), usage };
  }
}

export function createEmbedder(config = getConfig()): Embedder {
  const { env } = config;
  if (env.AI_PROVIDER === 'openai') {
    if (!env.OPENAI_API_KEY) throw new SetupRequiredError('OpenAI', ['OPENAI_API_KEY']);
    return new CachingEmbedder(
      new OpenAiCompatibleEmbedder('openai', {
        baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_EMBEDDING_MODEL,
        usdPerMillionTokens: OPENAI_EMBEDDING_USD_PER_MTOK,
      }),
    );
  }
  if (env.AI_PROVIDER === 'local') {
    if (!env.LOCAL_AI_BASE_URL) throw new SetupRequiredError('Local model', ['LOCAL_AI_BASE_URL']);
    return new CachingEmbedder(
      new OpenAiCompatibleEmbedder('local', {
        baseUrl: env.LOCAL_AI_BASE_URL,
        model: env.LOCAL_AI_EMBEDDING_MODEL ?? 'nomic-embed-text',
        usdPerMillionTokens: 0,
      }),
    );
  }
  return new FixtureEmbedder();
}
