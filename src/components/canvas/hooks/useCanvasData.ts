"use client";

import * as React from "react";
import type { Viewport } from "@xyflow/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CanvasEdge, CanvasNode, Task } from "@/types/domain";

type Db = SupabaseClient<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Janela em que um nó arrastado localmente ignora posições vindas do realtime. */
const LOCAL_MOVE_GRACE_MS = 1500;

interface UseCanvasDataOptions {
  supabase: Db;
  workspaceId: string;
  projectSlug: string;
  canvasIdParam: string;
}

/**
 * Carga inicial (escopada ao workspace) + sincronização realtime de nós,
 * arestas e tarefas do canvas.
 */
export function useCanvasData({ supabase, workspaceId, projectSlug, canvasIdParam }: UseCanvasDataOptions) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [projectId, setProjectId] = React.useState("");
  const [canvasId, setCanvasId] = React.useState("");
  const [initialViewport, setInitialViewport] = React.useState<Viewport | undefined>();
  const [nodes, setNodes] = React.useState<CanvasNode[]>([]);
  const [edges, setEdges] = React.useState<CanvasEdge[]>([]);
  const [tasks, setTasks] = React.useState<Record<string, Task>>({});

  const nodesRef = React.useRef<CanvasNode[]>([]);
  const edgesRef = React.useRef<CanvasEdge[]>([]);
  const tasksRef = React.useRef<Record<string, Task>>({});
  nodesRef.current = nodes;
  edgesRef.current = edges;
  tasksRef.current = tasks;

  const locallyMoving = React.useRef<Map<string, number>>(new Map());
  const markLocallyMoving = React.useCallback((nodeId: string) => {
    locallyMoving.current.set(nodeId, Date.now());
  }, []);

  // ---- Carga inicial ----
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // Projeto resolvido DENTRO do workspace (todo workspace tem um projeto "app")
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("slug", projectSlug)
        .maybeSingle();
      if (cancelled) return;
      if (!project) {
        setError("Projeto não encontrado.");
        setLoading(false);
        return;
      }

      let canvas: Database["public"]["Tables"]["canvases"]["Row"] | null = null;
      if (UUID_RE.test(canvasIdParam)) {
        const { data } = await supabase
          .from("canvases")
          .select("*")
          .eq("id", canvasIdParam)
          .eq("project_id", project.id)
          .maybeSingle();
        canvas = data;
      }
      if (!canvas) {
        const { data } = await supabase
          .from("canvases")
          .select("*")
          .eq("project_id", project.id)
          .eq("is_default", true)
          .limit(1)
          .maybeSingle();
        canvas = data;
      }
      if (cancelled) return;
      if (!canvas) {
        setError("Canvas não encontrado.");
        setLoading(false);
        return;
      }

      const [nodesRes, edgesRes, tasksRes] = await Promise.all([
        supabase.from("canvas_nodes").select("*").eq("canvas_id", canvas.id),
        supabase.from("canvas_edges").select("*").eq("canvas_id", canvas.id),
        supabase.from("tasks").select("*").eq("project_id", project.id),
      ]);
      if (cancelled) return;
      const firstError = nodesRes.error ?? edgesRes.error ?? tasksRes.error;
      if (firstError) {
        setError(`Falha ao carregar o canvas: ${firstError.message}`);
        setLoading(false);
        return;
      }

      setProjectId(project.id);
      setCanvasId(canvas.id);
      setInitialViewport(canvas.viewport as unknown as Viewport);
      setNodes((nodesRes.data as unknown as CanvasNode[]) ?? []);
      setEdges((edgesRes.data as unknown as CanvasEdge[]) ?? []);
      const taskMap: Record<string, Task> = {};
      for (const t of (tasksRes.data as unknown as Task[]) ?? []) taskMap[t.id] = t;
      setTasks(taskMap);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, workspaceId, projectSlug, canvasIdParam]);

  // ---- Realtime ----
  React.useEffect(() => {
    if (!canvasId || !projectId) return;

    const channel = supabase
      .channel(`canvas-${canvasId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvas_nodes", filter: `canvas_id=eq.${canvasId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const inserted = payload.new as unknown as CanvasNode;
            setNodes((prev) => (prev.some((n) => n.id === inserted.id) ? prev : [...prev, inserted]));
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as unknown as CanvasNode;
            const movedAt = locallyMoving.current.get(updated.id);
            const keepLocalPosition = movedAt !== undefined && Date.now() - movedAt < LOCAL_MOVE_GRACE_MS;
            if (!keepLocalPosition) locallyMoving.current.delete(updated.id);
            setNodes((prev) =>
              prev.map((n) =>
                n.id === updated.id
                  ? keepLocalPosition
                    ? { ...updated, position_x: n.position_x, position_y: n.position_y }
                    : updated // aceita movimentos de outros usuários e do auto-layout
                  : n
              )
            );
          } else if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id: string }).id;
            setNodes((prev) => prev.filter((n) => n.id !== removedId));
            setEdges((prev) => prev.filter((e) => e.source_node_id !== removedId && e.target_node_id !== removedId));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvas_edges", filter: `canvas_id=eq.${canvasId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const inserted = payload.new as unknown as CanvasEdge;
            setEdges((prev) => (prev.some((e) => e.id === inserted.id) ? prev : [...prev, inserted]));
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as unknown as CanvasEdge;
            setEdges((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
          } else if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id: string }).id;
            setEdges((prev) => prev.filter((e) => e.id !== removedId));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const t = payload.new as unknown as Task;
            setTasks((prev) => ({ ...prev, [t.id]: { ...(prev[t.id] ?? {}), ...t } }));
          } else if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id: string }).id;
            setTasks((prev) => {
              const next = { ...prev };
              delete next[removedId];
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, canvasId, projectId]);

  const patchTask = React.useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks((prev) => (prev[taskId] ? { ...prev, [taskId]: { ...prev[taskId], ...updates } } : prev));
  }, []);

  return {
    loading,
    error,
    projectId,
    canvasId,
    initialViewport,
    setInitialViewport,
    nodes,
    setNodes,
    edges,
    setEdges,
    tasks,
    setTasks,
    patchTask,
    nodesRef,
    edgesRef,
    tasksRef,
    markLocallyMoving,
  };
}
