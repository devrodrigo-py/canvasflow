"use client";

import * as React from "react";
import type { Viewport } from "@xyflow/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { CanvasEdge, CanvasNode, CanvasNodeType, Task } from "@/types/domain";

type Db = SupabaseClient<Database>;
type SelectedNode = { id: string; type: CanvasNodeType; title?: string; content?: string };

const POSITION_SAVE_DEBOUNCE_MS = 300;
const VIEWPORT_SAVE_DEBOUNCE_MS = 800;
const STICKY_COLORS = ["#fef9c3", "#dcfce7", "#dbeafe", "#fce7f3", "#e0e7ff"];

interface UseCanvasMutationsOptions {
  supabase: Db;
  canvasId: string;
  projectId: string;
  userName: string;
  canWrite: boolean;
  nodesRef: React.MutableRefObject<CanvasNode[]>;
  edgesRef: React.MutableRefObject<CanvasEdge[]>;
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<CanvasEdge[]>>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  markLocallyMoving: (nodeId: string) => void;
  notify: (message: string, tone?: "info" | "error") => void;
}

/** Todas as escritas do canvas: otimistas, com rollback/aviso em caso de erro. */
export function useCanvasMutations({
  supabase,
  canvasId,
  projectId,
  userName,
  canWrite,
  nodesRef,
  edgesRef,
  setNodes,
  setEdges,
  setTasks,
  markLocallyMoving,
  notify,
}: UseCanvasMutationsOptions) {
  const positionTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const viewportTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingTaskPosition, setPendingTaskPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [isAIRunning, setIsAIRunning] = React.useState(false);

  const fail = React.useCallback(
    (action: string, error: { message: string } | null | undefined) => {
      if (!error) return false;
      notify(`${action}: ${error.message}`, "error");
      return true;
    },
    [notify]
  );

  const guard = React.useCallback(() => {
    if (!canWrite) notify("Você tem acesso somente leitura neste workspace.");
    return canWrite;
  }, [canWrite, notify]);

  const addNodeToState = React.useCallback(
    (row: unknown) => {
      const node = row as CanvasNode;
      setNodes((prev) => (prev.some((n) => n.id === node.id) ? prev : [...prev, node]));
    },
    [setNodes]
  );

  // Limpa timers pendentes ao desmontar
  React.useEffect(() => {
    const timers = positionTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      if (viewportTimer.current) clearTimeout(viewportTimer.current);
    };
  }, []);

  // ---- Posições e viewport ----

  const schedulePositionSave = React.useCallback(
    (nodeId: string, x: number, y: number) => {
      markLocallyMoving(nodeId);
      const existing = positionTimers.current.get(nodeId);
      if (existing) clearTimeout(existing);
      positionTimers.current.set(
        nodeId,
        setTimeout(async () => {
          positionTimers.current.delete(nodeId);
          markLocallyMoving(nodeId);
          const { error } = await supabase
            .from("canvas_nodes")
            .update({ position_x: x, position_y: y })
            .eq("id", nodeId);
          fail("Falha ao salvar posição", error);
        }, POSITION_SAVE_DEBOUNCE_MS)
      );
    },
    [supabase, markLocallyMoving, fail]
  );

  /**
   * Mescla apenas posição/tamanho vindos do React Flow. A versão anterior
   * substituía o estado inteiro pelo round-trip do RF e perdia parent_frame_id,
   * task_id e needs_auto_layout.
   */
  const handleNodesChange = React.useCallback(
    (changedNodes: CanvasNode[]) => {
      const changedById = new Map(changedNodes.map((n) => [n.id, n]));
      setNodes((prev) =>
        prev.map((n) => {
          const c = changedById.get(n.id);
          if (!c) return n;
          const moved = c.position_x !== n.position_x || c.position_y !== n.position_y;
          if (moved && canWrite) schedulePositionSave(n.id, c.position_x, c.position_y);
          if (!moved && c.width === n.width && c.height === n.height) return n;
          return {
            ...n,
            position_x: c.position_x,
            position_y: c.position_y,
            width: c.width ?? n.width,
            height: c.height ?? n.height,
          };
        })
      );
    },
    [setNodes, schedulePositionSave, canWrite]
  );

  /** Arestas removidas no React Flow (selecionar + Delete) agora são apagadas no banco. */
  const handleEdgesChange = React.useCallback(
    (changedEdges: CanvasEdge[]) => {
      const keep = new Set(changedEdges.map((e) => e.id));
      const removed = edgesRef.current.filter((e) => !keep.has(e.id));
      if (removed.length === 0) return;
      if (!guard()) return;
      setEdges((prev) => prev.filter((e) => keep.has(e.id)));
      void (async () => {
        const { error } = await supabase
          .from("canvas_edges")
          .delete()
          .in(
            "id",
            removed.map((e) => e.id)
          );
        if (fail("Falha ao remover conexão", error)) setEdges((prev) => [...prev, ...removed]);
      })();
    },
    [edgesRef, setEdges, supabase, fail, guard]
  );

  const saveViewport = React.useCallback(
    (viewport: Viewport) => {
      if (!canvasId || !canWrite) return;
      if (viewportTimer.current) clearTimeout(viewportTimer.current);
      viewportTimer.current = setTimeout(() => {
        void supabase
          .from("canvases")
          .update({ viewport: viewport as unknown as Json })
          .eq("id", canvasId);
      }, VIEWPORT_SAVE_DEBOUNCE_MS);
    },
    [canvasId, canWrite, supabase]
  );

  // ---- Criação ----

  const insertNode = React.useCallback(
    async (row: Database["public"]["Tables"]["canvas_nodes"]["Insert"], label: string) => {
      if (!guard()) return;
      const { data, error } = await supabase.from("canvas_nodes").insert(row).select("*").single();
      if (fail(`Falha ao criar ${label}`, error)) return;
      addNodeToState(data);
    },
    [supabase, guard, fail, addNodeToState]
  );

  const addStickyNote = React.useCallback(
    (position: { x: number; y: number }) =>
      insertNode(
        {
          canvas_id: canvasId,
          node_type: "sticky_note",
          position_x: position.x,
          position_y: position.y,
          data: {
            color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)],
            text: "Novo post-it",
          },
        },
        "post-it"
      ),
    [canvasId, insertNode]
  );

  const addFrame = React.useCallback(
    (position: { x: number; y: number }) =>
      insertNode(
        {
          canvas_id: canvasId,
          node_type: "frame",
          position_x: position.x,
          position_y: position.y,
          width: 600,
          height: 400,
          data: { title: "Novo Frame", description: "" },
        },
        "frame"
      ),
    [canvasId, insertNode]
  );

  const addDocBlock = React.useCallback(
    (position: { x: number; y: number }) =>
      insertNode(
        {
          canvas_id: canvasId,
          node_type: "doc_block",
          position_x: position.x,
          position_y: position.y,
          data: { title: "Nota", content: "Duplo clique para editar" },
        },
        "bloco de doc"
      ),
    [canvasId, insertNode]
  );

  /** Abre o diálogo de título (substitui window.prompt). */
  const requestAddTask = React.useCallback(
    (position: { x: number; y: number }) => {
      if (!guard()) return;
      setPendingTaskPosition(position);
    },
    [guard]
  );

  /** Tarefa + card numa única transação (RPC). */
  const createTaskAt = React.useCallback(
    async (title: string) => {
      const position = pendingTaskPosition ?? { x: 0, y: 0 };
      const { data, error } = await supabase.rpc("create_task_with_node", {
        p_canvas_id: canvasId,
        p_title: title,
        p_position_x: position.x,
        p_position_y: position.y,
        p_actor_label: userName,
      });
      if (error) throw new Error(error.message);
      const result = data as unknown as { task: Task; node: CanvasNode };
      setTasks((prev) => ({ ...prev, [result.task.id]: result.task }));
      addNodeToState(result.node);
      setPendingTaskPosition(null);
    },
    [supabase, canvasId, pendingTaskPosition, userName, setTasks, addNodeToState]
  );

  /** Promove post-it em tarefa preservando posição e conexões (RPC transacional). */
  const promoteStickyNote = React.useCallback(
    async (nodeId: string) => {
      if (!guard()) return;
      const { data, error } = await supabase.rpc("promote_sticky_to_task", {
        p_node_id: nodeId,
        p_actor_label: userName,
      });
      if (fail("Falha ao promover post-it", error)) return;
      const result = data as unknown as { task: Task; node: CanvasNode };
      setTasks((prev) => ({ ...prev, [result.task.id]: result.task }));
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? result.node : n)));
    },
    [supabase, userName, guard, fail, setTasks, setNodes]
  );

  // ---- Edição ----

  const updateNodeData = React.useCallback(
    async (nodeId: string, patch: (data: Record<string, unknown>) => Record<string, unknown>) => {
      if (!guard()) return;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const previous = node.data;
      const data = patch(node.data);
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      const { error } = await supabase
        .from("canvas_nodes")
        .update({ data: data as Json })
        .eq("id", nodeId);
      if (fail("Falha ao salvar", error)) {
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: previous } : n)));
      }
    },
    [guard, nodesRef, setNodes, supabase, fail]
  );

  const updateStickyNote = React.useCallback(
    (nodeId: string, text: string, color?: string) =>
      updateNodeData(nodeId, (d) => ({ ...d, text, ...(color ? { color } : {}) })),
    [updateNodeData]
  );

  const updateFrame = React.useCallback(
    (nodeId: string, title: string, description?: string) =>
      updateNodeData(nodeId, (d) => ({ ...d, title, description: description ?? (d.description as string) ?? "" })),
    [updateNodeData]
  );

  const toggleFrameCollapse = React.useCallback(
    (nodeId: string) => updateNodeData(nodeId, (d) => ({ ...d, collapsed: !d.collapsed })),
    [updateNodeData]
  );

  const updateDocBlock = React.useCallback(
    (nodeId: string, title: string, content: string) => updateNodeData(nodeId, (d) => ({ ...d, title, content })),
    [updateNodeData]
  );

  const deleteNode = React.useCallback(
    async (nodeId: string) => {
      if (!guard()) return;
      const snapshotNodes = nodesRef.current;
      const snapshotEdges = edgesRef.current;
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId));
      // Apagar o card NÃO apaga a tarefa nem suas dependências (fonte da verdade é o backlog)
      const { error } = await supabase.from("canvas_nodes").delete().eq("id", nodeId);
      if (fail("Falha ao remover", error)) {
        setNodes(snapshotNodes);
        setEdges(snapshotEdges);
      }
    },
    [guard, nodesRef, edgesRef, setNodes, setEdges, supabase, fail]
  );

  const deleteFrame = React.useCallback(
    async (nodeId: string) => {
      if (!guard()) return;
      // Solta os filhos no canvas antes de remover o frame
      const { error: detachError } = await supabase
        .from("canvas_nodes")
        .update({ parent_frame_id: null })
        .eq("parent_frame_id", nodeId);
      if (fail("Falha ao remover frame", detachError)) return;
      setNodes((prev) => prev.map((n) => (n.parent_frame_id === nodeId ? { ...n, parent_frame_id: null } : n)));
      await deleteNode(nodeId);
    },
    [guard, supabase, fail, setNodes, deleteNode]
  );

  const duplicateNode = React.useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      if (node.node_type === "task_card") {
        notify("Cards de tarefa não podem ser duplicados; crie uma nova tarefa.");
        return;
      }
      const isFrame = node.node_type === "frame";
      await insertNode(
        {
          canvas_id: node.canvas_id,
          node_type: node.node_type,
          position_x: node.position_x + (isFrame ? 80 : 40),
          position_y: node.position_y + (isFrame ? 80 : 40),
          width: node.width,
          height: node.height,
          data: (isFrame
            ? { ...node.data, title: `${(node.data.title as string) ?? "Frame"} (cópia)`, isAIInbox: false }
            : node.data) as Json,
        },
        "cópia"
      );
    },
    [nodesRef, insertNode, notify]
  );

  const createEdge = React.useCallback(
    async (sourceId: string, targetId: string) => {
      if (!guard() || sourceId === targetId) return;
      const { data, error } = await supabase
        .from("canvas_edges")
        .insert({ canvas_id: canvasId, source_node_id: sourceId, target_node_id: targetId, edge_type: "relates_to" })
        .select("*")
        .single();
      if (error?.code === "23505") return; // já existe
      if (fail("Falha ao conectar", error) || !data) return;
      setEdges((prev) => (prev.some((e) => e.id === data.id) ? prev : [...prev, data as unknown as CanvasEdge]));
    },
    [guard, supabase, canvasId, fail, setEdges]
  );

  // ---- IA ----

  const callAI = React.useCallback(
    async <T,>(path: string, body: unknown): Promise<T | null> => {
      setIsAIRunning(true);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          notify(json?.error ?? "Falha na IA. Verifique a chave em Settings > Chaves de IA.", "error");
          return null;
        }
        return json as T;
      } catch {
        notify("Não foi possível contatar a IA.", "error");
        return null;
      } finally {
        setIsAIRunning(false);
      }
    },
    [notify]
  );

  const aiDiagnostic = React.useCallback(async () => {
    const data = await callAI<{ executive_summary?: string }>("/api/ai/summarize-canvas", { project_id: projectId });
    if (data) notify(data.executive_summary ?? "Diagnóstico concluído.");
  }, [callAI, projectId, notify]);

  const decomposeEpic = React.useCallback(
    async (selected: SelectedNode[]) => {
      if (!guard()) return;
      const data = await callAI<{ created_task_keys?: string[] }>("/api/ai/decompose-epic", {
        canvas_id: canvasId,
        source_nodes: selected.map((n) => ({ id: n.id, type: n.type, title: n.title, content: n.content })),
      });
      // Os cards chegam via realtime e o auto-layout os posiciona
      if (data?.created_task_keys?.length) {
        notify(`${data.created_task_keys.length} tarefas criadas: ${data.created_task_keys.join(", ")}`);
      }
    },
    [guard, callAI, canvasId, notify]
  );

  const clusterNotes = React.useCallback(
    async (selected: SelectedNode[]) => {
      if (!guard()) return;
      const data = await callAI<{ message?: string }>("/api/ai/cluster-notes", {
        canvas_id: canvasId,
        sticky_note_ids: selected.filter((n) => n.type === "sticky_note").map((n) => n.id),
      });
      if (data) notify(data.message ?? "Post-its agrupados.");
    },
    [guard, callAI, canvasId, notify]
  );

  const promoteSelected = React.useCallback(
    async (selected: SelectedNode[]) => {
      // Sequencial: evita rajadas de RPC e mantém a ordem das task_keys
      for (const node of selected) {
        if (node.type === "sticky_note") await promoteStickyNote(node.id);
      }
    },
    [promoteStickyNote]
  );

  return {
    handleNodesChange,
    handleEdgesChange,
    saveViewport,
    addStickyNote,
    addFrame,
    addDocBlock,
    requestAddTask,
    createTaskAt,
    pendingTaskPosition,
    cancelAddTask: () => setPendingTaskPosition(null),
    promoteStickyNote,
    updateStickyNote,
    updateFrame,
    toggleFrameCollapse,
    updateDocBlock,
    deleteNode,
    deleteFrame,
    duplicateNode,
    createEdge,
    isAIRunning,
    aiDiagnostic,
    decomposeEpic,
    clusterNotes,
    promoteSelected,
  };
}
