import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { CanvasNode, CanvasEdge, CanvasNodeType, CanvasEdgeType } from "@/types/domain";

type DbClient = SupabaseClient<Database>;

function rowToNode(row: Database["public"]["Tables"]["canvas_nodes"]["Row"]): CanvasNode {
  return {
    id: row.id,
    canvas_id: row.canvas_id,
    node_type: row.node_type,
    task_id: row.task_id,
    parent_frame_id: row.parent_frame_id,
    position_x: row.position_x,
    position_y: row.position_y,
    width: row.width,
    height: row.height,
    z_index: row.z_index,
    needs_auto_layout: row.needs_auto_layout,
    data: row.data as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToEdge(row: Database["public"]["Tables"]["canvas_edges"]["Row"]): CanvasEdge {
  return {
    id: row.id,
    canvas_id: row.canvas_id,
    source_node_id: row.source_node_id,
    target_node_id: row.target_node_id,
    edge_type: row.edge_type,
    label: row.label,
    created_at: row.created_at,
  };
}

export async function getCanvasById(db: DbClient, canvasId: string) {
  const { data, error } = await db.from("canvases").select("*").eq("id", canvasId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCanvasNodes(db: DbClient, canvasId: string): Promise<CanvasNode[]> {
  const { data, error } = await db.from("canvas_nodes").select("*").eq("canvas_id", canvasId);
  if (error) throw error;
  return (data ?? []).map(rowToNode);
}

export async function getCanvasEdges(db: DbClient, canvasId: string): Promise<CanvasEdge[]> {
  const { data, error } = await db.from("canvas_edges").select("*").eq("canvas_id", canvasId);
  if (error) throw error;
  return (data ?? []).map(rowToEdge);
}

export async function saveViewport(
  db: DbClient,
  canvasId: string,
  viewport: { x: number; y: number; zoom: number }
) {
  const { error } = await db
    .from("canvases")
    .update({ viewport })
    .eq("id", canvasId);
  if (error) throw error;
}

export interface CreateNodeInput {
  canvasId: string;
  nodeType: CanvasNodeType;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
  taskId?: string;
  parentFrameId?: string;
  width?: number;
  height?: number;
}

export async function createNode(db: DbClient, input: CreateNodeInput): Promise<CanvasNode> {
  const { data, error } = await db
    .from("canvas_nodes")
    .insert({
      canvas_id: input.canvasId,
      node_type: input.nodeType,
      position_x: input.position.x,
      position_y: input.position.y,
      data: (input.data ?? {}) as Database["public"]["Tables"]["canvas_nodes"]["Insert"]["data"],
      task_id: input.taskId ?? null,
      parent_frame_id: input.parentFrameId ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToNode(data);
}

export interface UpdateNodeInput {
  positionX?: number;
  positionY?: number;
  width?: number | null;
  height?: number | null;
  parentFrameId?: string | null;
  data?: Record<string, unknown>;
  needsAutoLayout?: boolean;
}

export async function updateNode(
  db: DbClient,
  nodeId: string,
  updates: UpdateNodeInput
): Promise<void> {
  const { error } = await db
    .from("canvas_nodes")
    .update({
      position_x: updates.positionX,
      position_y: updates.positionY,
      width: updates.width,
      height: updates.height,
      parent_frame_id: updates.parentFrameId,
      data: updates.data as Database["public"]["Tables"]["canvas_nodes"]["Update"]["data"],
      needs_auto_layout: updates.needsAutoLayout,
    })
    .eq("id", nodeId);
  if (error) throw error;
}

export async function batchUpdateNodePositions(
  db: DbClient,
  canvasId: string,
  positions: Array<{ id: string; x: number; y: number; width?: number | null; height?: number | null }>
): Promise<void> {
  // Atualizações em lote; cada linha inclui needs_auto_layout = false quando o nó foi posicionado
  const updates = positions.map((p) =>
    db
      .from("canvas_nodes")
      .update({
        position_x: p.x,
        position_y: p.y,
        ...(p.width !== undefined ? { width: p.width } : {}),
        ...(p.height !== undefined ? { height: p.height } : {}),
        needs_auto_layout: false,
      })
      .eq("id", p.id)
      .eq("canvas_id", canvasId)
  );
  await Promise.all(updates);
}

export async function deleteNode(db: DbClient, nodeId: string): Promise<void> {
  const { error } = await db.from("canvas_nodes").delete().eq("id", nodeId);
  if (error) throw error;
}

export interface CreateEdgeInput {
  canvasId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: CanvasEdgeType;
  label?: string;
}

export async function createEdge(db: DbClient, input: CreateEdgeInput): Promise<CanvasEdge | null> {
  const { data, error } = await db
    .from("canvas_edges")
    .insert({
      canvas_id: input.canvasId,
      source_node_id: input.sourceNodeId,
      target_node_id: input.targetNodeId,
      edge_type: input.edgeType,
      label: input.label,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return null; // Aresta duplicada — idempotente
    throw error;
  }
  return data ? rowToEdge(data) : null;
}

export async function deleteEdge(db: DbClient, edgeId: string): Promise<void> {
  const { error } = await db.from("canvas_edges").delete().eq("id", edgeId);
  if (error) throw error;
}

export async function getAIInboxFrame(db: DbClient, canvasId: string) {
  const { data, error } = await db
    .from("canvas_nodes")
    .select("*")
    .eq("canvas_id", canvasId)
    .eq("node_type", "frame")
    .contains("data", { isAIInbox: true })
    .maybeSingle();
  if (error) throw error;
  return data ? rowToNode(data) : null;
}

/**
 * Promove um post-it a tarefa oficial: cria a linha em `tasks`,
 * converte o nó em task_card preservando posição e conexões.
 */
export async function promoteStickyNoteToTask(
  db: DbClient,
  params: {
    canvasId: string;
    nodeId: string;
    projectId: string;
    workspaceId: string;
    title: string;
    priority?: "low" | "medium" | "high" | "urgent";
    actorUserId: string;
    actorLabel: string;
  }
): Promise<{ taskId: string; taskKey: string }> {
  const { data: node, error: nodeError } = await db
    .from("canvas_nodes")
    .select("*")
    .eq("id", params.nodeId)
    .single();
  if (nodeError) throw nodeError;
  if (node.node_type !== "sticky_note") {
    throw new Error("Node is not a sticky note");
  }

  const stickyText = ((node.data as Record<string, unknown>)?.text as string) ?? "";
  const title = params.title || stickyText.split("\n")[0] || "Nova tarefa";

  const { data: task, error: taskError } = await db
    .from("tasks")
    .insert({
      project_id: params.projectId,
      title,
      type: "task",
      priority: params.priority ?? "medium",
      spec_markdown: stickyText,
      last_updated_by_type: "human",
      last_updated_by_label: params.actorLabel,
    })
    .select("*")
    .single();
  if (taskError) throw taskError;

  const { error: convertError } = await db
    .from("canvas_nodes")
    .update({
      node_type: "task_card",
      task_id: task.id,
      data: { title },
    })
    .eq("id", params.nodeId);
  if (convertError) throw convertError;

  const { error: logError } = await db.from("activity_logs").insert({
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    task_id: task.id,
    actor_type: "human",
    actor_user_id: params.actorUserId,
    actor_label: params.actorLabel,
    action: "node.promoted",
    payload: { node_id: params.nodeId, task_key: task.task_key },
  });
  if (logError) throw logError;

  return { taskId: task.id, taskKey: task.task_key };
}
