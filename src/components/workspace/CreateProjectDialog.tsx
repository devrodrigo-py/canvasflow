"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";

function suggestPrefix(name: string): string {
  const letters = slugify(name).replace(/-/g, "").toUpperCase();
  return letters.slice(0, 3).padEnd(2, "X");
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [prefix, setPrefix] = React.useState("");
  const [prefixTouched, setPrefixTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setPrefix("");
      setPrefixTouched(false);
      setError(null);
    }
  }, [open]);

  const effectivePrefix = prefixTouched ? prefix : suggestPrefix(name);
  const slug = slugify(name);
  const prefixValid = /^[A-Z]{2,6}$/.test(effectivePrefix);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug || !prefixValid) return;
    setSubmitting(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("create_project_with_canvas", {
      p_workspace_id: workspace.id,
      p_name: name.trim(),
      p_slug: slug,
      p_key_prefix: effectivePrefix,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(
        rpcError.code === "23505"
          ? "Já existe um projeto com esse slug ou prefixo neste workspace."
          : rpcError.message
      );
      return;
    }
    onOpenChange(false);
    router.push(`/w/${workspace.slug}/p/${slug}/backlog`);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Novo projeto</DialogTitle>
            <DialogDescription>Cria o projeto com um canvas padrão e o frame &quot;Inbox da IA&quot;.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-name">Nome</Label>
            <Input id="project-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            {slug && <p className="text-xs text-muted-foreground">URL: /p/{slug}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-prefix">Prefixo das tarefas</Label>
            <Input
              id="project-prefix"
              value={effectivePrefix}
              maxLength={6}
              onChange={(e) => {
                setPrefixTouched(true);
                setPrefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""));
              }}
            />
            <p className="text-xs text-muted-foreground">2 a 6 letras, único no workspace (ex.: {effectivePrefix || "APP"}-1).</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !slug || !prefixValid}>
              Criar projeto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
