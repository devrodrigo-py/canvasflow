"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/workspace/CreateProjectDialog";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";

export function EmptyWorkspace() {
  const { canWrite, workspace } = useWorkspace();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">{workspace.name} ainda não tem projetos</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Projetos agrupam backlog, canvases e o acesso de agentes MCP.
      </p>
      {canWrite ? (
        <Button onClick={() => setOpen(true)}>Criar primeiro projeto</Button>
      ) : (
        <p className="text-sm text-muted-foreground">Peça a um membro com permissão de escrita para criar um projeto.</p>
      )}
      <CreateProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
