import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { CanvasNode, CanvasEdge, CanvasNodeType, CanvasEdgeType } from "@/types/domain";

type DbClient = SupabaseClient<Database>;

export interface CreateNodeInput {
  canvasId: string;
  nodeType: CanvasNodeType;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  taskId?: string;
  parentFrameId?: string;
  data?: Record<string, unknown>;
  needsAutoLayout?: boolean;
}

export async function createNode(db: DbClient, input: CreateNodeInput): Promise<CanvasNode> {
  const { data, error } = await db
    .from("canvas_nodes")
    .insert({
      canvas_id: input.canvasId,
      node_type: input.nodeType,
      position_x: input.position.x,
      position_y: input.position.y,
      width: input.width,
      height: input.height,
      task_id: input.taskId,
      parent_frame_id: input.parentFrameId,
      needs_auto_layout: input.needsAutoLayout ?? false,
      data: (input.data ?? {}) as Json,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as CanvasNode;
}

export interface CreateEdgeInput {
  canvasId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: CanvasEdgeType;
  label?: string;
}

/** Cria aresta; entre dois task cards o banco registra a dependência automaticamente. */
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
  return data as unknown as CanvasEdge;
}
