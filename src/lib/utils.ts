import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Aceita apenas caminhos internos ("/algo"), bloqueando open redirect.
 * Valida como o navegador normaliza a URL: ele descarta tab/CR/LF e trata a
 * barra invertida como "/", então variantes como "/<TAB>/evil.com" viram
 * "//evil.com" (outra origem). Por isso rejeitamos controle, espaço e barra invertida.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (/[\u0000-\u001f\u007f\s\\]/.test(next)) return fallback;
  if (next.startsWith("//")) return fallback;
  try {
    const base = "http://canvasflow.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
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
