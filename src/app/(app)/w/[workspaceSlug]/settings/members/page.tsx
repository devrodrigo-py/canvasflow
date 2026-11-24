"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Loader2, Trash2, UserPlus } from "lucide-react";
import type { WorkspaceRole } from "@/types/domain";

interface MemberRow {
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  name: string;
  joined_at: string;
}

interface InviteRow {
  id: string;
  email: string | null;
  role: WorkspaceRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Membro",
  viewer: "Leitor",
};

export default function MembersSettingsPage() {
  const { workspace, user, role, isAdmin } = useWorkspace();
  const supabase = React.useMemo(() => createClient(), []);

  const [members, setMembers] = React.useState<MemberRow[]>([]);
  const [invites, setInvites] = React.useState<InviteRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"admin" | "member" | "viewer">("member");
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setError("");
    const res = await fetch(`/api/workspaces/${workspace.id}/members`);
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.error ?? "Falha ao carregar membros");
    else setMembers(body.members ?? []);

    if (isAdmin) {
      const { data, error: invitesError } = await supabase
        .from("workspace_invites")
        .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
        .eq("workspace_id", workspace.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (invitesError) setError(invitesError.message);
      else setInvites((data ?? []) as InviteRow[]);
    }
    setLoading(false);
  }, [workspace.id, isAdmin, supabase]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const canManage = (target: MemberRow) =>
    isAdmin && target.user_id !== user.id && (target.role !== "owner" || role === "owner");

  const handleRoleChange = async (target: MemberRow, newRole: WorkspaceRole) => {
    setBusy(true);
    const { error: updateError, count } = await supabase
      .from("workspace_members")
      .update({ role: newRole }, { count: "exact" })
      .eq("workspace_id", workspace.id)
      .eq("user_id", target.user_id);
    setBusy(false);
    if (updateError) return setError(updateError.message);
    if (count === 0) return setError("Sem permissão para alterar este membro.");
    await load();
  };

  const handleRemove = async (target: MemberRow) => {
    const isSelf = target.user_id === user.id;
    if (!window.confirm(isSelf ? "Sair deste workspace?" : `Remover ${target.name} do workspace?`)) return;
    setBusy(true);
    const { error: deleteError } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("user_id", target.user_id);
    setBusy(false);
    if (deleteError) return setError(deleteError.message);
    if (isSelf) {
      window.location.href = "/";
      return;
    }
    await load();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInviteUrl(null);
    const res = await fetch(`/api/workspaces/${workspace.id}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() || null, role: inviteRole }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(body?.error ?? "Falha ao criar convite");
    setInviteUrl(body.invite_url);
    setInviteEmail("");
    await load();
  };

  const handleRevokeInvite = async (invite: InviteRow) => {
    const { error: revokeError } = await supabase
      .from("workspace_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (revokeError) return setError(revokeError.message);
    await load();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Membros</h1>
          <p className="text-sm text-muted-foreground">
            Owners e admins gerenciam acessos. Leitores só visualizam; membros editam backlog e canvas.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Convidar pessoa</CardTitle>
              <CardDescription>
                Gera um link de uso único válido por 7 dias. Com email preenchido, só essa conta pode aceitar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email (opcional)</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="pessoa@empresa.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Papel</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as typeof inviteRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Membro</SelectItem>
                      <SelectItem value="viewer">Leitor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={busy}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Gerar link
                </Button>
              </form>
              {inviteUrl && (
                <Alert>
                  <AlertDescription className="space-y-2">
                    <p className="text-sm">Copie agora — o link não será exibido novamente:</p>
                    <div className="flex gap-2">
                      <Input readOnly value={inviteUrl} className="font-mono text-xs" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => navigator.clipboard.writeText(inviteUrl)}
                        aria-label="Copiar link"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {invites.length > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm font-medium">Convites pendentes</p>
                  {invites.map((invite) => (
                    <div key={invite.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span>
                        {invite.email ?? "Qualquer pessoa com o link"} · {ROLE_LABELS[invite.role]} · expira{" "}
                        {new Date(invite.expires_at).toLocaleDateString()}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => handleRevokeInvite(invite)}>
                        Revogar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pessoas no workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.name} {m.user_id === user.id && <span className="text-muted-foreground">(você)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage(m) ? (
                      <Select value={m.role} onValueChange={(v) => handleRoleChange(m, v as WorkspaceRole)} disabled={busy}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Membro</SelectItem>
                          <SelectItem value="viewer">Leitor</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {(canManage(m) || m.user_id === user.id) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(m)}
                        disabled={busy}
                        aria-label={m.user_id === user.id ? "Sair do workspace" : "Remover membro"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
