import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Aceita apenas caminhos internos ("/algo"), bloqueando open redirect
 * ("//evil.com", "/\\evil.com", URLs absolutas).
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}

/** Gera um slug ASCII a partir de um nome. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Ordena chaves de tarefa numericamente (APP-2 antes de APP-10). */
export function compareTaskKeys(a: string, b: string): number {
  const [pa, na] = splitTaskKey(a);
  const [pb, nb] = splitTaskKey(b);
  if (pa !== pb) return pa.localeCompare(pb);
  return na - nb;
}

function splitTaskKey(key: string): [string, number] {
  const idx = key.lastIndexOf("-");
  if (idx < 0) return [key, 0];
  return [key.slice(0, idx), Number(key.slice(idx + 1)) || 0];
}
