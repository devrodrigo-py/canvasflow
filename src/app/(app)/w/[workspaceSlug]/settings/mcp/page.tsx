"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MCPSetupCard } from "@/components/ai/MCPSetupCard";
import { Plug, Loader2, Trash2, ShieldCheck } from "lucide-react";

interface TokenRow {
  id: string;
  name: string;
  actor_label: string;
  token_prefix: string;
  scopes: string[];
  allow_direct_done: boolean;
  project_id: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function MCPSettingsPage() {
  const params = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = params?.workspaceSlug;
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [tokens, setTokens] = React.useState<TokenRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  // Formulário
  const [name, setName] = React.useState("Claude Code - Meu computador");
  const [actorLabel, setActorLabel] = React.useState("Claude Agent");
  const [projectId, setProjectId] = React.useState<string>("all");
  const [allowDirectDone, setAllowDirectDone] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [newToken, setNewToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;

    async function load() {
      const { data: ws } = await supabase.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle();
      if (!ws || cancelled) {
        setLoading(false);
        return;
      }
      setWorkspaceId(ws.id);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: member } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", ws.id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) setRole(member?.role ?? null);
      }

      const { data: projectList } = await supabase
        .from("projects")
        .select("id, name, slug")
        .eq("workspace_id", ws.id);
      if (!cancelled) setProjects(projectList ?? []);

      await refreshTokens(ws.id);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  async function refreshTokens(wsId: string) {
    const res = await fetch(`/api/keys/mcp-tokens?workspace_id=${wsId}`);
    if (res.ok) {
      const body = await res.json();
      setTokens(body.tokens ?? []);
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Falha ao carregar tokens");
    }
  }

  const isAdmin = role === "owner" || role === "admin";

  const handleCreate = async () => {
    if (!workspaceId) return;
    setIsCreating(true);
    setError("");
    setSuccess("");
    setNewToken(null);

    try {
      const res = await fetch(`/api/keys/mcp-tokens?workspace_id=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          actor_label: actorLabel,
          project_id: projectId === "all" ? null : projectId,
          scopes: ["tasks:read", "tasks:write", "canvas:write"],
          allow_direct_done: allowDirectDone,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Falha ao criar token");
        return;
      }
      setNewToken(body.token);
      setSuccess(body.message ?? "Token criado.");
      await refreshTokens(workspaceId);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (token: TokenRow) => {
    if (!workspaceId) return;
    await fetch(`/api/keys/mcp-tokens`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, token_id: token.id }),
    });
    await refreshTokens(workspaceId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Plug className="h-6 w-6" />
          Agentes MCP
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tokens PAT para agentes externos (Claude Code, Claude Desktop, Cursor) conectarem-se ao
          servidor MCP em <code className="font-mono">/api/mcp</code>.
        </p>
      </div>

      {!isAdmin && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription>
            Apenas owners e admins do workspace podem gerenciar tokens MCP.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && !newToken && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Gerar novo token</CardTitle>
            <CardDescription>
              O token completo é exibido uma única vez — apenas o hash SHA-256 é armazenado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="token-name">Nome</Label>
                <Input
                  id="token-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Claude Code - MacBook"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="actor-label">Label do ator (no canvas)</Label>
                <Input id="actor-label" value={actorLabel} onChange={(e) => setActorLabel(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Escopo de projeto</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os projetos</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col justify-center gap-1">
                <div className="flex items-center gap-3">
                  <Switch checked={allowDirectDone} onCheckedChange={setAllowDirectDone} id="allow-done" />
                  <Label htmlFor="allow-done">Permitir concluir (done) diretamente</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Desativado (recomendado): agente só pode mover até <strong>in_review</strong>; aprovação
                  humana é exigida para concluir.
                </p>
              </div>
            </div>

            <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Gerar token
            </Button>

            {newToken && (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    <span className="font-medium">Copie o token agora:</span>{" "}
                    <code className="font-mono bg-muted px-1.5 py-0.5 rounded break-all">{newToken}</code>
                  </AlertDescription>
                </Alert>
                <MCPSetupCard
                  url={`${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp`}
                  token={newToken}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tokens existentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum token criado ainda.</p>
          )}
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{token.name}</span>
                  {token.revoked_at ? (
                    <Badge variant="destructive">Revogado</Badge>
                  ) : (
                    <Badge variant="default">Ativo</Badge>
                  )}
                  {token.allow_direct_done && <Badge variant="secondary">allow_direct_done</Badge>}
                </div>
                <p className="text-xs text-muted-foreground font-mono">{token.token_prefix}…</p>
                <p className="text-xs text-muted-foreground">
                  Escopos: {token.scopes.join(", ")}
                  {token.last_used_at && ` · Último uso: ${new Date(token.last_used_at).toLocaleString()}`}
                </p>
              </div>
              {isAdmin && !token.revoked_at && (
                <Button variant="ghost" size="icon" onClick={() => handleRevoke(token)} aria-label="Revogar">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
