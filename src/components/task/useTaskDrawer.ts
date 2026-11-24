"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ActivityLog, Comment, Task } from "@/types/domain";
import { EMPTY_SPEC_JSON } from "@/lib/spec-format";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";

type Db = SupabaseClient<Database>;
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

const EDITABLE_FIELDS = [
  "title",
  "status",
  "priority",
  "type",
  "sprint",
  "estimate_points",
  "assignee_id",
  "parent_task_id",
  "spec_markdown",
  "spec_json",
  "acceptance_criteria",
] as const;

/** Monta o UPDATE só com campos editáveis por humanos (nunca agent_execution_log). */
export function buildHumanTaskUpdate(updates: Partial<Task>, actorLabel: string): TaskUpdate {
  const payload: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (updates[field] !== undefined) payload[field] = updates[field];
  }
  payload.last_updated_by_type = "human";
  payload.last_updated_by_label = actorLabel;
  return payload as TaskUpdate;
}

interface UseTaskDrawerOptions {
  supabase: Db;
  /** Busca a tarefa no estado da página (canvas/backlog). */
  getTask: (taskId: string) => Task | undefined;
  /** Aplica uma atualização otimista no estado da página. */
  patchTask: (taskId: string, updates: Partial<Task>) => void;
  onError?: (message: string) => void;
}

/**
 * Estado e ações do TaskDrawer, compartilhados entre canvas e backlog.
 * Auditoria das tarefas é feita por trigger no banco (sem inserts manuais aqui).
 */
export function useTaskDrawer({ supabase, getTask, patchTask, onError }: UseTaskDrawerOptions) {
  const { workspace, user, canWrite } = useWorkspace();
  const [drawerTaskId, setDrawerTaskId] = React.useState<string | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [activities, setActivities] = React.useState<ActivityLog[]>([]);
  const [isGeneratingSpec, setIsGeneratingSpec] = React.useState(false);
  const report = React.useCallback((message: string) => (onError ? onError(message) : console.error(message)), [onError]);

  const loadSidebarData = React.useCallback(
    async (taskId: string) => {
      const [{ data: commentRows }, { data: activityRows }] = await Promise.all([
        supabase.from("comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
        supabase
          .from("activity_logs")
          .select("*")
          .eq("task_id", taskId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      setComments((commentRows as unknown as Comment[]) ?? []);
      setActivities(((activityRows as unknown as ActivityLog[]) ?? []).reverse());
    },
    [supabase]
  );

  const open = React.useCallback(
    async (taskId: string) => {
      if (!getTask(taskId)) return;
      setDrawerTaskId(taskId);
      setIsOpen(true);
      await loadSidebarData(taskId);
    },
    [getTask, loadSidebarData]
  );

  const close = React.useCallback(() => setIsOpen(false), []);

  const updateTask = React.useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      if (!canWrite) return;
      const before = getTask(taskId);
      patchTask(taskId, updates);
      const { error } = await supabase
        .from("tasks")
        .update(buildHumanTaskUpdate(updates, user.name))
        .eq("id", taskId);
      if (error) {
        if (before) patchTask(taskId, before);
        report(`Falha ao salvar tarefa: ${error.message}`);
        throw error;
      }
    },
    [canWrite, getTask, patchTask, supabase, user.name, report]
  );

  const addComment = React.useCallback(
    async (taskId: string, body: string) => {
      const { data, error } = await supabase
        .from("comments")
        .insert({
          workspace_id: workspace.id,
          task_id: taskId,
          actor_type: "human",
          author_user_id: user.id,
          author_label: user.name,
          body_markdown: body,
        })
        .select("*")
        .single();
      if (error) throw error;
      setComments((prev) => [...prev, data as unknown as Comment]);
    },
    [supabase, workspace.id, user.id, user.name]
  );

  const updateComment = React.useCallback(
    async (commentId: string, body: string) => {
      const { error } = await supabase.from("comments").update({ body_markdown: body }).eq("id", commentId);
      if (error) throw error;
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, body_markdown: body } : c)));
    },
    [supabase]
  );

  const deleteComment = React.useCallback(
    async (commentId: string) => {
      const { error } = await supabase.from("comments").delete().eq("id", commentId);
      if (error) throw error;
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    },
    [supabase]
  );

  const resolveComment = React.useCallback(
    async (commentId: string, resolved: boolean) => {
      const { error } = await supabase.from("comments").update({ resolved }).eq("id", commentId);
      if (error) throw error;
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, resolved } : c)));
    },
    [supabase]
  );

  /** Aprovação humana de tarefa em revisão (o trigger registra task.status_changed). */
  const approveAndComplete = React.useCallback(
    async (taskId: string) => {
      await updateTask(taskId, { status: "done" });
      await loadSidebarData(taskId);
    },
    [updateTask, loadSidebarData]
  );

  /** Chama /api/ai/draft-spec e grava spec + critérios (spec_json zerado → editor relê o Markdown). */
  const generateSpec = React.useCallback(
    async (taskId: string) => {
      setIsGeneratingSpec(true);
      try {
        const res = await fetch("/api/ai/draft-spec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: taskId }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          report(body?.error ?? "Não foi possível gerar a spec com IA.");
          return;
        }
        await updateTask(taskId, {
          spec_markdown: body.spec_markdown as string,
          spec_json: EMPTY_SPEC_JSON as unknown as Task["spec_json"],
          acceptance_criteria: ((body.acceptance_criteria as string[]) ?? []).map((text) => ({
            id: crypto.randomUUID(),
            text,
            completed: false,
          })),
        });
      } catch {
        report("Não foi possível gerar a spec com IA.");
      } finally {
        setIsGeneratingSpec(false);
      }
    },
    [updateTask, report]
  );

  const drawerTask = drawerTaskId ? (getTask(drawerTaskId) ?? null) : null;

  return {
    drawerProps: {
      task: drawerTask,
      isOpen,
      onClose: close,
      onUpdateTask: updateTask,
      onAddComment: addComment,
      onUpdateComment: updateComment,
      onDeleteComment: deleteComment,
      onResolveComment: resolveComment,
      onApproveAndComplete: approveAndComplete,
      onGenerateSpec: generateSpec,
      currentUserId: user.id,
      comments,
      activities,
      readOnly: !canWrite,
      isGeneratingSpec,
    },
    open,
    updateTask,
  };
}
