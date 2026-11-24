import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import type { MCPContext } from "@/types/domain";

export class MCPAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPAuthError";
  }
}

export class MCPRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Limite de requisições do token excedido");
    this.name = "MCPRateLimitError";
  }
}

export class MCPScopeError extends Error {
  constructor(scope: string) {
    super(`Token não possui o escopo necessário: ${scope}`);
    this.name = "MCPScopeError";
  }
}

/** 120 requisições por minuto por token. */
const MCP_LIMIT = 120;
const MCP_WINDOW_MS = 60_000;

/**
 * Valida `Authorization: Bearer cf_pat_...`, rejeita tokens revogados/expirados,
 * aplica rate limit por token e resolve o contexto (workspace, projeto, escopos).
 */
export async function authenticateMCPRequest(request: Request): Promise<MCPContext> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new MCPAuthError("Header Authorization com Bearer token é obrigatório");
  }

  const token = authHeader.slice(7).trim();
  if (!/^cf_pat_[0-9a-f]{64}$/.test(token)) {
    throw new MCPAuthError("Formato de token inválido (esperado cf_pat_...)");
  }

  const admin = createAdminClient();
  const { data: tokenRow, error } = await admin
    .from("agent_tokens")
    .select("id, workspace_id, project_id, actor_label, scopes, allow_direct_done, expires_at")
    .eq("token_hash", sha256(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw new MCPAuthError("Falha ao validar token");
  if (!tokenRow) throw new MCPAuthError("Token inválido ou revogado");
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    throw new MCPAuthError("Token expirado — gere um novo em Settings > Agentes MCP");
  }

  const limit = rateLimit(`mcp:${tokenRow.id}`, MCP_LIMIT, MCP_WINDOW_MS);
  if (!limit.ok) throw new MCPRateLimitError(limit.retryAfterSeconds);

  // Fire-and-forget: last_used_at não deve atrasar a resposta, mas falhas são logadas
  void admin
    .from("agent_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id)
    .then(({ error: updateError }) => {
      if (updateError) console.warn("mcp: falha ao atualizar last_used_at", updateError.message);
    });

  return {
    workspaceId: tokenRow.workspace_id,
    projectId: tokenRow.project_id ?? null,
    actorLabel: tokenRow.actor_label,
    scopes: tokenRow.scopes ?? [],
    allowDirectDone: tokenRow.allow_direct_done,
  };
}

export function requireScope(context: MCPContext, scope: string): void {
  if (!context.scopes.includes(scope)) throw new MCPScopeError(scope);
}

/**
 * Hosts aceitos pelo transporte MCP (proteção contra DNS rebinding).
 * Deriva de NEXT_PUBLIC_APP_URL e MCP_ALLOWED_HOSTS (lista separada por vírgula).
 */
export function getAllowedMcpHosts(): string[] | undefined {
  const hosts = new Set<string>();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).host);
    } catch {
      // URL inválida: ignora
    }
  }
  for (const h of (process.env.MCP_ALLOWED_HOSTS ?? "").split(",")) {
    if (h.trim()) hosts.add(h.trim());
  }
  return hosts.size > 0 ? [...hosts] : undefined;
}
