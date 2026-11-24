import "server-only";

/**
 * Rate limiter de janela deslizante em memória (por instância).
 * Suficiente para um único servidor Node; em ambiente serverless com várias
 * instâncias troque por um backend compartilhado (ex.: Upstash/Redis) mantendo
 * a mesma interface.
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const windowStart = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  hits.push(now);
  buckets.set(key, hits);

  if (buckets.size > MAX_KEYS) {
    // Evita crescimento sem limite: descarta as chaves mais antigas
    const excess = buckets.size - MAX_KEYS;
    let i = 0;
    for (const k of buckets.keys()) {
      if (i++ >= excess) break;
      buckets.delete(k);
    }
  }

  return { ok: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
