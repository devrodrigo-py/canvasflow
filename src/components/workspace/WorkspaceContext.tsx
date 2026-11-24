"use client";

import * as React from "react";
import type { WorkspaceRole } from "@/types/domain";

export interface WorkspaceClientContext {
  user: { id: string; email: string | null; name: string };
  workspace: { id: string; name: string; slug: string };
  role: WorkspaceRole;
  canWrite: boolean;
  isAdmin: boolean;
}

const Ctx = React.createContext<WorkspaceClientContext | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: Omit<WorkspaceClientContext, "canWrite" | "isAdmin">;
  children: React.ReactNode;
}) {
  const full = React.useMemo<WorkspaceClientContext>(
    () => ({
      ...value,
      canWrite: value.role !== "viewer",
      isAdmin: value.role === "owner" || value.role === "admin",
    }),
    [value]
  );
  return <Ctx.Provider value={full}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceClientContext {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace deve ser usado dentro de WorkspaceProvider");
  return ctx;
}
