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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyRound, Loader2, Trash2, PlayCircle, PowerCircle, ShieldCheck } from "lucide-react";

interface AIKeyRow {
  id: string;
  provider: "anthropic" | "openai" | "google";
  default_model: string;
  key_preview: string;
  is_active: boolean;
  created_at: string;
}

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  google: ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-2.5-flash"],
};

export default function AISettingsPage() {
  const params = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = params?.workspaceSlug;
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<AIKeyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  // Formulário
  const [provider, setProvider] = React.useState<"anthropic" | "openai" | "google">("anthropic");
  const [apiKey, setApiKey] = React.useState("");
  const [defaultModel, setDefaultModel] = React.useState(PROVIDER_MODELS.anthropic[0]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);

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

      await refreshKeys(ws.id);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  async function refreshKeys(wsId: string) {
    const res = await fetch(`/api/keys/ai?workspace_id=${wsId}`);
    if (res.ok) {
      const body = await res.json();
      setKeys(body.keys ?? []);
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Falha ao carregar chaves");
    }
  }

  const isAdmin = role === "owner" || role === "admin";

  const handleSave = async () => {
    if (!workspaceId) return;
    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/keys/ai?workspace_id=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey, default_model: defaultModel }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Falha ao salvar chave");
        return;
      }
      setSuccess(body.message ?? "Chave salva.");
      setApiKey("");
      await refreshKeys(workspaceId);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/keys/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey }),
      });
      const body = await res.json();
      if (body.ok) {
        setSuccess(`Chave válida — ${body.detail}`);
      } else {
        setError(`Teste falhou: ${body.detail}`);
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggle = async (key: AIKeyRow) => {
    if (!workspaceId) return;
    await fetch(`/api/keys/ai`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        provider: key.provider,
        is_active: !key.is_active,
        default_model: key.default_model,
      }),
    });
    await refreshKeys(workspaceId);
  };

  const handleDelete = async (key: AIKeyRow) => {
    if (!workspaceId) return;
    await fetch(`/api/keys/ai`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, provider: key.provider }),
    });
    await refreshKeys(workspaceId);
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
          <KeyRound className="h-6 w-6" />
          Chaves de IA (BYOK)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure a chave de API do provedor de IA usado pelo workspace. As chaves são
          criptografadas em repouso com AES-256-GCM e nunca são retornadas ao cliente.
        </p>
      </div>

      {!isAdmin && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription>
            Apenas owners e admins do workspace podem gerenciar chaves de IA.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar / substituir chave</CardTitle>
            <CardDescription>
              Uma chave ativa por provedor. Ao salvar, a chave é criptografada antes de tocar o banco.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider">Provedor</Label>
                <Select
                  value={provider}
                  onValueChange={(value) => {
                    const p = value as typeof provider;
                    setProvider(p);
                    setDefaultModel(PROVIDER_MODELS[p][0]);
                  }}
                >
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google">Google (Gemini)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Modelo padrão</Label>
                <Select value={defaultModel} onValueChange={setDefaultModel}>
                  <SelectTrigger id="model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_MODELS[provider].map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_key">Chave de API</Label>
              <Input
                id="api_key"
                type="password"
                placeholder={provider === "anthropic" ? "sk-ant-..." : provider === "openai" ? "sk-..." : "AIza..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isSaving || !apiKey}>
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar chave
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={isTesting || !apiKey}>
                {isTesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <PlayCircle className="h-4 w-4 mr-2" />
                Testar conexão
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Chaves configuradas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {keys.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma chave configurada ainda.</p>
          )}
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{key.provider}</span>
                  <Badge variant={key.is_active ? "default" : "secondary"}>
                    {key.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{key.key_preview}</p>
                <p className="text-xs text-muted-foreground">Modelo: {key.default_model}</p>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleToggle(key)} aria-label="Ativar/desativar">
                    <PowerCircle className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(key)} aria-label="Remover">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
