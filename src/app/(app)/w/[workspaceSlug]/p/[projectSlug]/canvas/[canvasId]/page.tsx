"use client";

import * as React from "react";
import { ReactFlowProvider, Viewport } from "@xyflow/react";
import { HybridCanvas } from "@/components/canvas/HybridCanvas";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { AIChatPanel } from "@/components/ai/AIChatPanel";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { calculateAutoLayout, positionNodesAroundParent } from "@/lib/layout/elkLayout";
import {
  CanvasNode,
  CanvasEdge,
  Task,
  Comment,
  ActivityLog,
  CanvasNodeType,
} from "@/types/domain";
import { Loader2, Sparkles } from "lucide-react";

interface CanvasPageProps {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    canvasId: string;
  }>;
  searchParams: Promise<{ focus?: string }>;
}

const CURSOR_THROTTLE_MS = 50;
const POSITION_SAVE_DEBOUNCE_MS = 300;
const VIEWPORT_SAVE_DEBOUNCE_MS = 800;

const CURSOR_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

interface PresenceUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  cursor?: { x: number; y: number };
  viewport?: Viewport;
}

export default function CanvasPage({ params, searchParams }: CanvasPageProps) {
  const [resolvedParams, setResolvedParams] = React.useState<{
    workspaceSlug: string;
    projectSlug: string;
    canvasId: string;
  } | null>(null);
  const [focusTaskKey, setFocusTaskKey] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [canvasId, setCanvasId] = React.useState<string>("");
  const [projectId, setProjectId] = React.useState<string>("");
  const [workspaceId, setWorkspaceId] = React.useState<string>("");
  const [nodes, setNodes] = React.useState<CanvasNode[]>([]);
  const [edges, setEdges] = React.useState<CanvasEdge[]>([]);
  const [initialViewport, setInitialViewport] = React.useState<Viewport | undefined>();
  const [tasks, setTasks] = React.useState<Record<string, Task>>({});

  const [currentUserId, setCurrentUserId] = React.useState<string>("");
  const [currentUserName, setCurrentUserName] = React.useState<string>("Você");
  const [presenceUsers, setPresenceUsers] = React.useState<PresenceUser[]>([]);
  const [followedUserId, setFollowedUserId] = React.useState<string | null>(null);

  const [isAutoLayoutRunning, setIsAutoLayoutRunning] = React.useState(false);
  const [isFullscreenDrawer, setIsFullscreenDrawer] = React.useState(false);

  // Chat IA
  const lastViewportRef = React.useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [chatOrigin, setChatOrigin] = React.useState({ x: 0, y: 0 });

  // TaskDrawer state
  const [drawerTask, setDrawerTask] = React.useState<Task | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const [drawerComments, setDrawerComments] = React.useState<Comment[]>([]);
  const [drawerActivities, setDrawerActivities] = React.useState<ActivityLog[]>([]);

  const supabase = React.useMemo(() => createClient(), []);

  // Refs para handlers estáveis dentro de callbacks de realtime
  const nodesRef = React.useRef<CanvasNode[]>([]);
  const edgesRef = React.useRef<CanvasEdge[]>([]);
  const tasksRef = React.useRef<Record<string, Task>>({});
  const positionSaveTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const viewportSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorSent = React.useRef(0);
  const followAppliedRef = React.useRef<string>("");
  const userInteractedRef = React.useRef(false);

  nodesRef.current = nodes;
  edgesRef.current = edges;
  tasksRef.current = tasks;

  // Resolver params
  React.useEffect(() => {
    params.then(setResolvedParams);
    searchParams.then((sp) => setFocusTaskKey(sp.focus ?? null));
  }, [params, searchParams]);

  // Carga inicial
  React.useEffect(() => {
    if (!resolvedParams) return;
    const rp = resolvedParams;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }
      if (cancelled) return;
      setCurrentUserId(user.id);
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      setCurrentUserName((meta?.name as string) ?? (meta?.email as string)?.split("@")[0] ?? "Você");

      // Canvas pode vir como id real ou slug especial; resolver via projeto
      const { data: projectList } = await supabase
        .from("projects")
        .select("id, workspace_id, slug, workspace:workspaces!inner(slug)")
        .eq("slug", rp.projectSlug)
        .limit(1);

      const project = (projectList ?? [])[0];
      if (!project) {
        if (!cancelled) setError("Projeto não encontrado.");
        setLoading(false);
        return;
      }

      setProjectId(project.id);
      setWorkspaceId(project.workspace_id);

      // Resolver canvas: por id se for uuid válido, senão o canvas padrão
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rp.canvasId);
      let canvas;
      if (isUuid) {
        const { data } = await supabase
          .from("canvases")
          .select("*")
          .eq("id", rp.canvasId)
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
          .maybeSingle();
        canvas = data;
      }

      if (!canvas) {
        if (!cancelled) setError("Canvas não encontrado.");
        setLoading(false);
        return;
      }
      setCanvasId(canvas.id);
      setInitialViewport(canvas.viewport as Viewport | undefined);
      lastViewportRef.current = canvas.viewport as Viewport;

      const [{ data: nodesData }, { data: edgesData }, { data: tasksData }] = await Promise.all([
        supabase.from("canvas_nodes").select("*").eq("canvas_id", canvas.id),
        supabase.from("canvas_edges").select("*").eq("canvas_id", canvas.id),
        supabase.from("tasks").select("*").eq("project_id", project.id),
      ]);

      if (cancelled) return;
      setNodes((nodesData as unknown as CanvasNode[]) ?? []);
      setEdges((edgesData as unknown as CanvasEdge[]) ?? []);

      const taskMap: Record<string, Task> = {};
      for (const t of (tasksData as unknown as Task[]) ?? []) {
        taskMap[t.id] = t;
      }
      setTasks(taskMap);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, resolvedParams]);

  // Realtime: Postgres Changes para nós, arestas e tarefas
  React.useEffect(() => {
    if (!canvasId || !projectId) return;

    const channel = supabase
      .channel(`canvas-${canvasId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvas_nodes", filter: `canvas_id=eq.${canvasId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newNode = payload.new as unknown as CanvasNode;
            setNodes((prev) => {
              if (prev.some((n) => n.id === newNode.id)) return prev;
              return [...prev, newNode];
            });
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as unknown as CanvasNode;
            setNodes((prev) =>
              prev.map((n) =>
                n.id === updated.id
                  ? { ...updated, position_x: n.position_x, position_y: n.position_y }
                  : n
              )
            );
          } else if (payload.eventType === "DELETE") {
            setNodes((prev) => prev.filter((n) => n.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvas_edges", filter: `canvas_id=eq.${canvasId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newEdge = payload.new as unknown as CanvasEdge;
            setEdges((prev) => {
              if (prev.some((e) => e.id === newEdge.id)) return prev;
              return [...prev, newEdge];
            });
          } else if (payload.eventType === "DELETE") {
            setEdges((prev) => prev.filter((e) => e.id !== (payload.old as { id: string }).id));
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
            setDrawerTask((current) => (current && current.id === t.id ? { ...current, ...t } : current));
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id: string };
            setTasks((prev) => {
              const next = { ...prev };
              delete next[deleted.id];
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, canvasId, projectId]);

  // Presence + Broadcast de cursores e viewport
  React.useEffect(() => {
    if (!canvasId || !currentUserId) return;

    const channel = supabase.channel(`presence-canvas-${canvasId}`, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const p = payload as { userId: string; name: string; x: number; y: number };
        setPresenceUsers((prev) => {
          const others = prev.filter((u) => u.id !== p.userId);
          const existing = prev.find((u) => u.id === p.userId);
          return [
            ...others,
            {
              id: p.userId,
              name: p.name,
              color: existing?.color ?? colorForUser(p.userId),
              cursor: { x: p.x, y: p.y },
              viewport: existing?.viewport,
            },
          ];
        });
      })
      .on("broadcast", { event: "viewport" }, ({ payload }) => {
        const p = payload as { userId: string; viewport: Viewport };
        if (!followedUserId || p.userId !== followedUserId) return;
        setPresenceUsers((prev) =>
          prev.map((u) => (u.id === p.userId ? { ...u, viewport: p.viewport } : u))
        );
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users: PresenceUser[] = [];
        for (const [key, metas] of Object.entries(state)) {
          if (key === currentUserId) continue;
          const meta = metas[0] as Record<string, unknown> | undefined;
          users.push({
            id: key,
            name: (meta?.name as string) ?? "Usuário",
            avatar: meta?.avatar as string | undefined,
            color: (meta?.color as string) ?? colorForUser(key),
            viewport: undefined,
          });
        }
        setPresenceUsers((prev) =>
          users.map((u) => {
            const existing = prev.find((p) => p.id === u.id);
            return existing ?? u;
          })
        );
        // Remove usuários que saíram
        setPresenceUsers((prev) => prev.filter((u) => state[u.id]));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({ name: currentUserName, color: colorForUser(currentUserId) });
        }
      });

    const unsubscribe = () => {
      supabase.removeChannel(channel);
    };
    return unsubscribe;
  }, [supabase, canvasId, currentUserId, currentUserName, followedUserId]);

  // Follow Mode: aplica viewport do usuário seguido
  React.useEffect(() => {
    if (!followedUserId) return;
    const followed = presenceUsers.find((u) => u.id === followedUserId);
    if (!followed?.viewport) return;
    // Detecta mudança real para evitar loop
    const vp = followed.viewport;
    const key = `${vp.x}:${vp.y}:${vp.zoom}`;
    if (followAppliedRef.current !== key) {
      followAppliedRef.current = key;
      setInitialViewport(vp);
    }
  }, [followedUserId, presenceUsers]);

  const broadcastCursor = React.useCallback(
    (screen: { x: number; y: number }) => {
      if (!canvasId) return;
      const now = Date.now();
      if (now - lastCursorSent.current < CURSOR_THROTTLE_MS) return;
      lastCursorSent.current = now;
      const channel = supabase.channel(`presence-canvas-${canvasId}`);
      channel?.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId: currentUserId, name: currentUserName, x: screen.x, y: screen.y },
      });
    },
    [supabase, canvasId, currentUserId, currentUserName]
  );

  const broadcastViewport = React.useCallback(
    (viewport: Viewport) => {
      if (!canvasId || userInteractedRef.current) return;
      const channel = supabase.channel(`presence-canvas-${canvasId}`);
      channel?.send({
        type: "broadcast",
        event: "viewport",
        payload: { userId: currentUserId, viewport },
      });
    },
    [supabase, canvasId, currentUserId]
  );

  // Persistência de viewport com debounce
  const handleViewportChange = React.useCallback(
    (viewport: Viewport) => {
      lastViewportRef.current = viewport;
      if (followedUserId && userInteractedRef.current) {
        // Mover mouse/teclado encerra o follow mode
        setFollowedUserId(null);
        userInteractedRef.current = false;
        followAppliedRef.current = "";
      }
      broadcastViewport(viewport);
      if (!canvasId) return;
      if (viewportSaveTimer.current) clearTimeout(viewportSaveTimer.current);
      viewportSaveTimer.current = setTimeout(() => {
        supabase.from("canvases").update({ viewport }).eq("id", canvasId);
      }, VIEWPORT_SAVE_DEBOUNCE_MS);
    },
    [followedUserId, broadcastViewport, canvasId, supabase]
  );

  // Persistência de posições com debounce por nó (atualização otimista já aplicada)
  const schedulePositionSave = React.useCallback(
    (nodeId: string, x: number, y: number) => {
      if (!canvasId) return;
      const existing = positionSaveTimers.current.get(nodeId);
      if (existing) clearTimeout(existing);
      positionSaveTimers.current.set(
        nodeId,
        setTimeout(() => {
          supabase
            .from("canvas_nodes")
            .update({ position_x: x, position_y: y })
            .eq("id", nodeId);
          positionSaveTimers.current.delete(nodeId);
        }, POSITION_SAVE_DEBOUNCE_MS)
      );
    },
    [canvasId, supabase]
  );

  const handleNodesChange = React.useCallback(
    (changedNodes: CanvasNode[]) => {
      // Diff contra o estado atual para persistir apenas mudanças reais de posição/tamanho
      const current = nodesRef.current;
      for (const changed of changedNodes) {
        const before = current.find((n) => n.id === changed.id);
        if (!before) continue;
        if (
          changed.position_x !== before.position_x ||
          changed.position_y !== before.position_y
        ) {
          schedulePositionSave(changed.id, changed.position_x, changed.position_y);
        }
      }
      setNodes(changedNodes);
    },
    [schedulePositionSave]
  );

  const handleEdgesChange = React.useCallback((changedEdges: CanvasEdge[]) => {
    setEdges(changedEdges);
  }, []);

  // ---- Handlers de criação ----

  const handleAddStickyNote = React.useCallback(
    async (position: { x: number; y: number }) => {
      if (!canvasId) return;
      const colors = ["#fef9c3", "#dcfce7", "#dbeafe", "#fce7f3", "#e0e7ff"];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const { data, error } = await supabase
        .from("canvas_nodes")
        .insert({
          canvas_id: canvasId,
          node_type: "sticky_note",
          position_x: position.x,
          position_y: position.y,
          data: { color, text: "Novo post-it" },
        })
        .select("*")
        .single();
      if (error) {
        console.error("Falha ao criar post-it:", error);
        return;
      }
      setNodes((prev) => (prev.some((n) => n.id === data.id) ? prev : [...prev, data as unknown as CanvasNode]));
    },
    [canvasId, supabase]
  );

  const handleAddTask = React.useCallback(
    async (position: { x: number; y: number }) => {
      if (!canvasId || !projectId || !workspaceId) return;
      const title = window.prompt("Título da tarefa:");
      if (!title?.trim()) return;

      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          title: title.trim(),
          type: "task",
          last_updated_by_type: "human",
          last_updated_by_label: currentUserName,
        })
        .select("*")
        .single();
      if (taskError) {
        console.error("Falha ao criar tarefa:", taskError);
        return;
      }

      const { data: node, error: nodeError } = await supabase
        .from("canvas_nodes")
        .insert({
          canvas_id: canvasId,
          node_type: "task_card",
          task_id: task.id,
          position_x: position.x,
          position_y: position.y,
          data: { title: task.title },
        })
        .select("*")
        .single();
      if (nodeError) {
        console.error("Falha ao criar nó:", nodeError);
        return;
      }

      setTasks((prev) => ({ ...prev, [task.id]: task as unknown as Task }));
      setNodes((prev) => (prev.some((n) => n.id === node.id) ? prev : [...prev, node as unknown as CanvasNode]));

      await supabase.from("activity_logs").insert({
        workspace_id: workspaceId,
        project_id: projectId,
        task_id: task.id,
        actor_type: "human",
        actor_user_id: currentUserId,
        actor_label: currentUserName,
        action: "task.created",
        payload: { title: task.title },
      });
    },
    [canvasId, projectId, workspaceId, supabase, currentUserId, currentUserName]
  );

  const handleAddFrame = React.useCallback(
    async (position: { x: number; y: number }) => {
      if (!canvasId) return;
      const { data, error } = await supabase
        .from("canvas_nodes")
        .insert({
          canvas_id: canvasId,
          node_type: "frame",
          position_x: position.x,
          position_y: position.y,
          width: 600,
          height: 400,
          data: { title: "Novo Frame", description: "" },
        })
        .select("*")
        .single();
      if (error) {
        console.error("Falha ao criar frame:", error);
        return;
      }
      setNodes((prev) => (prev.some((n) => n.id === data.id) ? prev : [...prev, data as unknown as CanvasNode]));
    },
    [canvasId, supabase]
  );

  const handleAddDocBlock = React.useCallback(
    async (position: { x: number; y: number }) => {
      if (!canvasId) return;
      const { data, error } = await supabase
        .from("canvas_nodes")
        .insert({
          canvas_id: canvasId,
          node_type: "doc_block",
          position_x: position.x,
          position_y: position.y,
          data: { title: "Nota", content: "Duplo clique para editar" },
        })
        .select("*")
        .single();
      if (error) {
        console.error("Falha ao criar bloco de doc:", error);
        return;
      }
      setNodes((prev) => (prev.some((n) => n.id === data.id) ? prev : [...prev, data as unknown as CanvasNode]));
    },
    [canvasId, supabase]
  );

  // ---- Handlers de edição ----

  const handlePromoteStickyNote = React.useCallback(
    async (nodeId: string, _text: string, _color: string) => {
      if (!canvasId || !projectId || !workspaceId) return;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const text = (node.data.text as string) ?? "";
      const title = text.split("\n")[0] || "Nova tarefa";

      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          type: "task",
          spec_markdown: text,
          last_updated_by_type: "human",
          last_updated_by_label: currentUserName,
        })
        .select("*")
        .single();
      if (taskError) {
        console.error("Falha ao promover post-it:", taskError);
        return;
      }

      const { error: convertError } = await supabase
        .from("canvas_nodes")
        .update({ node_type: "task_card", task_id: task.id, data: { title } })
        .eq("id", nodeId);
      if (convertError) {
        console.error("Falha ao converter nó:", convertError);
        return;
      }

      setTasks((prev) => ({ ...prev, [task.id]: task as unknown as Task }));
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, node_type: "task_card" as CanvasNodeType, task_id: task.id, data: { title } } : n
        )
      );

      await supabase.from("activity_logs").insert({
        workspace_id: workspaceId,
        project_id: projectId,
        task_id: task.id,
        actor_type: "human",
        actor_user_id: currentUserId,
        actor_label: currentUserName,
        action: "node.promoted",
        payload: { node_id: nodeId, task_key: task.task_key },
      });
    },
    [canvasId, projectId, workspaceId, supabase, currentUserId, currentUserName]
  );

  const handleUpdateStickyNote = React.useCallback(
    async (nodeId: string, text: string, color?: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const data = { ...node.data, text, ...(color ? { color } : {}) };
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      await supabase.from("canvas_nodes").update({ data }).eq("id", nodeId);
    },
    [supabase]
  );

  const handleDeleteNode = React.useCallback(
    async (nodeId: string) => {
      if (!canvasId) return;
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId));
      await supabase.from("canvas_nodes").delete().eq("id", nodeId);
    },
    [canvasId, supabase]
  );

  const handleDuplicateNode = React.useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || !canvasId) return;
      const { data, error } = await supabase
        .from("canvas_nodes")
        .insert({
          canvas_id: canvasId,
          node_type: node.node_type,
          position_x: node.position_x + 40,
          position_y: node.position_y + 40,
          width: node.width,
          height: node.height,
          data: node.data,
        })
        .select("*")
        .single();
      if (error) return;
      setNodes((prev) => (prev.some((n) => n.id === data.id) ? prev : [...prev, data as unknown as CanvasNode]));
    },
    [canvasId, supabase]
  );

  const handleUpdateFrame = React.useCallback(
    async (nodeId: string, title: string, description?: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const data = { ...node.data, title, description: description ?? (node.data.description as string) ?? "" };
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      await supabase.from("canvas_nodes").update({ data }).eq("id", nodeId);
    },
    [supabase]
  );

  const handleDeleteFrame = React.useCallback(
    async (nodeId: string) => {
      // Remove o frame mas preserva os nós filhos (solta para o canvas)
      setNodes((prev) =>
        prev.map((n) => (n.parent_frame_id === nodeId ? { ...n, parent_frame_id: null } : n))
      );
      await supabase.from("canvas_nodes").update({ parent_frame_id: null }).eq("parent_frame_id", nodeId);
      await supabase.from("canvas_nodes").delete().eq("id", nodeId);
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    },
    [supabase]
  );

  const handleDuplicateFrame = React.useCallback(
    async (nodeId: string) => {
      const frame = nodesRef.current.find((n) => n.id === nodeId);
      if (!frame || !canvasId) return;
      const { data, error } = await supabase
        .from("canvas_nodes")
        .insert({
          canvas_id: canvasId,
          node_type: "frame",
          position_x: frame.position_x + 80,
          position_y: frame.position_y + 80,
          width: frame.width,
          height: frame.height,
          data: { ...frame.data, title: `${frame.data.title ?? "Frame"} (cópia)` },
        })
        .select("*")
        .single();
      if (error) return;
      setNodes((prev) => (prev.some((n) => n.id === data.id) ? prev : [...prev, data as unknown as CanvasNode]));
    },
    [canvasId, supabase]
  );

  const handleToggleFrameCollapse = React.useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const data = { ...node.data, collapsed: !node.data.collapsed };
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      await supabase.from("canvas_nodes").update({ data }).eq("id", nodeId);
    },
    [supabase]
  );

  const handleUpdateDocBlock = React.useCallback(
    async (nodeId: string, title: string, content: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const data = { ...node.data, title, content };
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      await supabase.from("canvas_nodes").update({ data }).eq("id", nodeId);
    },
    [supabase]
  );

  const handleDeleteDocBlock = handleDeleteNode;
  const handleDuplicateDocBlock = handleDuplicateNode;
  const handleOpenDocBlockEditor = React.useCallback((_nodeId: string) => {
    // Edição inline já cobre o caso; hook reservado para modal avançado
  }, []);

  // ---- Conexões ----

  const handleCreateEdge = React.useCallback(
    async (sourceId: string, targetId: string) => {
      if (!canvasId) return;
      const { data, error } = await supabase
        .from("canvas_edges")
        .insert({
          canvas_id: canvasId,
          source_node_id: sourceId,
          target_node_id: targetId,
          edge_type: "relates_to",
        })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") return; // duplicada — ok
        console.error("Falha ao criar aresta:", error);
        return;
      }
      setEdges((prev) => (prev.some((e) => e.id === data.id) ? prev : [...prev, data as unknown as CanvasEdge]));
    },
    [canvasId, supabase]
  );

  // ---- Auto-layout ----

  const runAutoLayout = React.useCallback(async () => {
    if (!canvasId || isAutoLayoutRunning) return;
    setIsAutoLayoutRunning(true);
    try {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const result = await calculateAutoLayout(currentNodes, currentEdges, {
        direction: "DOWN",
        hierarchyHandling: "INCLUDE_CHILDREN",
      });

      const positionMap = new Map(result.nodes.map((n) => [n.id, n]));

      // Atualização otimista
      setNodes((prev) =>
        prev.map((n) => {
          const pos = positionMap.get(n.id);
          return pos ? { ...n, position_x: pos.x, position_y: pos.y, needs_auto_layout: false } : n;
        })
      );

      // Persistência em lote (inclui needs_auto_layout = false)
      const positions = [...positionMap.values()].map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
      }));
      await Promise.all(
        positions.map((p) =>
          supabase
            .from("canvas_nodes")
            .update({ position_x: p.x, position_y: p.y, needs_auto_layout: false })
            .eq("id", p.id)
            .eq("canvas_id", canvasId)
        )
      );
    } finally {
      setIsAutoLayoutRunning(false);
    }
  }, [canvasId, isAutoLayoutRunning, supabase]);

  // Efeito reativo: nós com needs_auto_layout = true (criados por IA/MCP) são posicionados
  const autoLayoutCycleRef = React.useRef(false);
  React.useEffect(() => {
    const pending = nodes.filter((n) => n.needs_auto_layout);
    if (pending.length === 0 || autoLayoutCycleRef.current || !canvasId) return;

    autoLayoutCycleRef.current = true;
    let cancelled = false;

    async function layoutPending() {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const pendingNodes = currentNodes.filter((n) => n.needs_auto_layout);

      // Posiciona ao lado do pai (se existir aresta parent_of) ou dentro do Inbox da IA
      const inboxFrame = currentNodes.find(
        (n) => n.node_type === "frame" && (n.data.isAIInbox === true || n.data.title === "Inbox da IA")
      );

      const positions: Array<{ id: string; x: number; y: number; width?: number | null; height?: number | null }> = [];

      for (const node of pendingNodes) {
        const parentEdge = currentEdges.find(
          (e) => e.target_node_id === node.id && e.edge_type === "parent_of"
        );
        if (parentEdge) {
          const parent = currentNodes.find((n) => n.id === parentEdge.source_node_id);
          if (parent) {
            const around = positionNodesAroundParent(parent, [node], 80);
            positions.push({
              id: node.id,
              x: around[0].x,
              y: around[0].y,
              width: node.width,
              height: node.height,
            });
            continue;
          }
        }
        if (inboxFrame) {
          positions.push({
            id: node.id,
            x: inboxFrame.position_x + 40,
            y: inboxFrame.position_y + 80 + positions.length * 180,
            width: node.width,
            height: node.height,
          });
        }
      }

      if (positions.length > 0) {
        // Atualização otimista
        const posMap = new Map(positions.map((p) => [p.id, p]));
        setNodes((prev) =>
          prev.map((n) => {
            const pos = posMap.get(n.id);
            return pos
              ? { ...n, position_x: pos.x, position_y: pos.y, needs_auto_layout: false }
              : n;
          })
        );
        await Promise.all(
          positions.map((p) =>
            supabase
              .from("canvas_nodes")
              .update({ position_x: p.x, position_y: p.y, needs_auto_layout: false })
              .eq("id", p.id)
          )
        );
      } else {
        await calculateAutoLayout(pendingNodes, currentEdges).then(async (result) => {
          const posMap = new Map(result.nodes.map((n) => [n.id, n]));
          setNodes((prev) =>
            prev.map((n) => {
              const pos = posMap.get(n.id);
              return pos
                ? { ...n, position_x: pos.x, position_y: pos.y, needs_auto_layout: false }
                : n;
            })
          );
          await Promise.all(
            result.nodes.map((p) =>
              supabase
                .from("canvas_nodes")
                .update({ position_x: p.x, position_y: p.y, needs_auto_layout: false })
                .eq("id", p.id)
            )
          );
        });
      }
    }

    layoutPending()
      .catch((err) => console.error("Auto-layout falhou:", err))
      .finally(() => {
        if (!cancelled) {
          // Libera o próximo ciclo apenas após persistir needs_auto_layout = false
          setTimeout(() => {
            autoLayoutCycleRef.current = false;
          }, 500);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nodes, canvasId, supabase]);

  // ---- IA / Diagnóstico (Fase 5) ----

  const handleAIDiagnostic = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch("/api/ai/summarize-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? "Configure uma chave de IA em Settings > AI para usar o diagnóstico.");
        return;
      }
      const data = await res.json();
      alert(data.executive_summary ?? "Diagnóstico concluído.");
    } catch {
      alert("Não foi possível executar o diagnóstico de IA.");
    }
  }, [projectId]);

  const handleDecomposeEpic = React.useCallback(
    async (selectedNodes: Array<{ id: string; type: CanvasNodeType; title?: string; content?: string }>) => {
      if (!projectId || !canvasId) return;
      setIsAutoLayoutRunning(true);
      try {
        const res = await fetch("/api/ai/decompose-epic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canvas_id: canvasId,
            source_nodes: selectedNodes.map((n) => ({ id: n.id, type: n.type, title: n.title, content: n.content })),
          }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          alert(body?.error ?? "Configure uma chave de IA em Settings > AI.");
          return;
        }
        const created = body?.created_task_keys as string[] | undefined;
        if (created?.length) {
          alert(`${created.length} tarefas criadas: ${created.join(", ")}`);
        }
        // Os nós chegam via realtime (postgres changes) e o efeito de auto-layout os posiciona
      } finally {
        setIsAutoLayoutRunning(false);
      }
    },
    [projectId, canvasId]
  );

  const handleClusterNotes = React.useCallback(
    async (selectedNodes: Array<{ id: string; type: CanvasNodeType; title?: string; content?: string }>) => {
      if (!projectId || !canvasId) return;
      setIsAutoLayoutRunning(true);
      try {
        const res = await fetch("/api/ai/cluster-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canvas_id: canvasId,
            sticky_note_ids: selectedNodes.map((n) => n.id),
          }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          alert(body?.error ?? "Configure uma chave de IA em Settings > AI.");
          return;
        }
        alert(body?.message ?? "Post-its agrupados.");
      } finally {
        setIsAutoLayoutRunning(false);
      }
    },
    [projectId, canvasId]
  );

  const handlePromoteSelected = React.useCallback(
    (selectedNodes: Array<{ id: string; type: CanvasNodeType; title?: string; content?: string }>) => {
      for (const node of selectedNodes) {
        if (node.type === "sticky_note") {
          void handlePromoteStickyNote(node.id, node.content ?? "", "");
        }
      }
    },
    [handlePromoteStickyNote]
  );

  // ---- TaskDrawer ----

  const openTaskDrawer = React.useCallback(
    async (taskId: string) => {
      const task = tasksRef.current[taskId];
      if (!task) return;
      setDrawerTask(task);
      setIsDrawerOpen(true);

      const [{ data: comments }, { data: activities }] = await Promise.all([
        supabase.from("comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
        supabase
          .from("activity_logs")
          .select("*")
          .eq("task_id", taskId)
          .order("created_at", { ascending: true })
          .limit(100),
      ]);
      setDrawerComments((comments as unknown as Comment[]) ?? []);
      setDrawerActivities((activities as unknown as ActivityLog[]) ?? []);
    },
    [supabase]
  );

  const handleUpdateTask = React.useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      const { error } = await supabase
        .from("tasks")
        .update({
          ...(updates.title !== undefined ? { title: updates.title } : {}),
          ...(updates.status !== undefined ? { status: updates.status } : {}),
          ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
          ...(updates.type !== undefined ? { type: updates.type } : {}),
          ...(updates.sprint !== undefined ? { sprint: updates.sprint } : {}),
          ...(updates.estimate_points !== undefined ? { estimate_points: updates.estimate_points } : {}),
          ...(updates.assignee_id !== undefined ? { assignee_id: updates.assignee_id } : {}),
          ...(updates.spec_markdown !== undefined ? { spec_markdown: updates.spec_markdown } : {}),
          ...(updates.spec_json !== undefined ? { spec_json: updates.spec_json } : {}),
          ...(updates.acceptance_criteria !== undefined ? { acceptance_criteria: updates.acceptance_criteria } : {}),
          last_updated_by_type: "human",
          last_updated_by_label: null,
        })
        .eq("id", taskId);
      if (error) throw error;
    },
    [supabase]
  );

  const handleAddComment = React.useCallback(
    async (taskId: string, body: string) => {
      if (!workspaceId) return;
      const { data, error } = await supabase
        .from("comments")
        .insert({
          workspace_id: workspaceId,
          task_id: taskId,
          actor_type: "human",
          author_user_id: currentUserId,
          author_label: currentUserName,
          body_markdown: body,
        })
        .select("*")
        .single();
      if (error) throw error;
      setDrawerComments((prev) => [...prev, data as Comment]);
    },
    [supabase, workspaceId, currentUserId, currentUserName]
  );

  const handleUpdateComment = React.useCallback(
    async (commentId: string, body: string) => {
      const { error } = await supabase.from("comments").update({ body_markdown: body }).eq("id", commentId);
      if (error) throw error;
      setDrawerComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, body_markdown: body } : c)));
    },
    [supabase]
  );

  const handleDeleteComment = React.useCallback(
    async (commentId: string) => {
      const { error } = await supabase.from("comments").delete().eq("id", commentId);
      if (error) throw error;
      setDrawerComments((prev) => prev.filter((c) => c.id !== commentId));
    },
    [supabase]
  );

  const handleResolveComment = React.useCallback(
    async (commentId: string, resolved: boolean) => {
      const { error } = await supabase.from("comments").update({ resolved }).eq("id", commentId);
      if (error) throw error;
      setDrawerComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, resolved } : c)));
    },
    [supabase]
  );

  const handleApproveAndComplete = React.useCallback(
    async (taskId: string) => {
      if (!projectId || !workspaceId) return;
      const task = tasksRef.current[taskId];
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done", last_updated_by_type: "human", last_updated_by_label: currentUserName })
        .eq("id", taskId);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        workspace_id: workspaceId,
        project_id: projectId,
        task_id: taskId,
        actor_type: "human",
        actor_user_id: currentUserId,
        actor_label: currentUserName,
        action: "task.approved",
        payload: { from: task?.status ?? "in_review", to: "done" },
      });
    },
    [supabase, projectId, workspaceId, currentUserId, currentUserName]
  );

  const handleGenerateSpec = React.useCallback(
    async (taskId: string) => {
      const task = tasksRef.current[taskId];
      if (!task) return;
      try {
        const res = await fetch("/api/ai/draft-spec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            task_title: task.title,
          }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          alert(body?.error ?? "Configure uma chave de IA em Settings > AI.");
          return;
        }
        if (body?.spec_markdown) {
          await handleUpdateTask(taskId, {
            spec_markdown: body.spec_markdown,
            acceptance_criteria: (body.acceptance_criteria as string[]).map((text, i) => ({
              id: `${Date.now()}-${i}`,
              text,
              completed: false,
            })),
          });
        }
      } catch {
        alert("Não foi possível gerar a spec com IA.");
      }
    },
    [handleUpdateTask]
  );

  // Foco em tarefa via query param (?focus=APP-1)
  React.useEffect(() => {
    if (!focusTaskKey || loading || Object.keys(tasks).length === 0) return;
    const task = Object.values(tasks).find((t) => t.task_key === focusTaskKey);
    if (!task) return;
    const node = nodes.find((n) => n.task_id === task.id);
    if (node) {
      setInitialViewport({ x: -node.position_x, y: -node.position_y, zoom: 1.2 });
      void openTaskDrawer(task.id);
    }
    setFocusTaskKey(null);
  }, [focusTaskKey, loading, tasks, nodes, openTaskDrawer]);

  if (loading || !resolvedParams) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div
      className="h-[calc(100vh-4rem)] w-full"
      onMouseMove={(e) => broadcastCursor({ x: e.clientX, y: e.clientY })}
      onKeyDown={() => {
        userInteractedRef.current = true;
      }}
      onMouseDown={() => {
        userInteractedRef.current = true;
      }}
    >
      <ReactFlowProvider>
      <HybridCanvas
        canvasId={canvasId}
        projectId={projectId}
        initialNodes={nodes}
        initialEdges={edges}
        initialViewport={initialViewport}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onViewportChange={handleViewportChange}
        onAddStickyNote={handleAddStickyNote}
        onAddTask={handleAddTask}
        onAddFrame={handleAddFrame}
        onAddDocBlock={handleAddDocBlock}
        onPromoteStickyNote={handlePromoteStickyNote}
        onUpdateStickyNote={handleUpdateStickyNote}
        onDeleteNode={handleDeleteNode}
        onDuplicateNode={handleDuplicateNode}
        onUpdateFrame={handleUpdateFrame}
        onDeleteFrame={handleDeleteFrame}
        onDuplicateFrame={handleDuplicateFrame}
        onToggleFrameCollapse={handleToggleFrameCollapse}
        onUpdateDocBlock={handleUpdateDocBlock}
        onDeleteDocBlock={handleDeleteDocBlock}
        onDuplicateDocBlock={handleDuplicateDocBlock}
        onOpenDocBlockEditor={handleOpenDocBlockEditor}
        onOpenTaskDrawer={openTaskDrawer}
        onAutoLayout={runAutoLayout}
        onAIDiagnostic={handleAIDiagnostic}
        onDecomposeEpic={handleDecomposeEpic}
        onClusterNotes={handleClusterNotes}
        onPromoteStickyNotes={handlePromoteSelected}
        presenceUsers={presenceUsers}
        currentUserId={currentUserId}
        followedUserId={followedUserId}
        onFollowUser={setFollowedUserId}
        isAutoLayoutRunning={isAutoLayoutRunning}
        tasks={tasks}
      />

      <TaskDrawer
        task={drawerTask}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateTask={handleUpdateTask}
        onAddComment={handleAddComment}
        onUpdateComment={handleUpdateComment}
        onDeleteComment={handleDeleteComment}
        onResolveComment={handleResolveComment}
        onApproveAndComplete={handleApproveAndComplete}
        onGenerateSpec={handleGenerateSpec}
        currentUserId={currentUserId}
        comments={drawerComments}
        activities={drawerActivities}
        isFullscreen={isFullscreenDrawer}
        onToggleFullscreen={() => setIsFullscreenDrawer((v) => !v)}
      />

      {/* Assistente IA: chat conversacional que cria elementos no canvas */}
      {!isChatOpen && (
        <Button
          className="fixed bottom-4 right-4 z-50 gap-2 shadow-lg"
          onClick={() => {
            // Origem = centro da área visível do canvas em coordenadas de fluxo
            const vp = lastViewportRef.current;
            const sidebarWidth = 240;
            const centerX = sidebarWidth + (window.innerWidth - sidebarWidth) / 2;
            const centerY = window.innerHeight / 2 - 100;
            setChatOrigin({
              x: Math.round((centerX - vp.x) / vp.zoom),
              y: Math.round((centerY - vp.y) / vp.zoom),
            });
            setIsChatOpen(true);
          }}
        >
          <Sparkles className="h-4 w-4" />
          Assistente IA
        </Button>
      )}
      <AIChatPanel
        canvasId={canvasId}
        suggestedOrigin={chatOrigin}
        open={isChatOpen}
        onOpenChange={setIsChatOpen}
      />
      </ReactFlowProvider>
    </div>
  );
}
