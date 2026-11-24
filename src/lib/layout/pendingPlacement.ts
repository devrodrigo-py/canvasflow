import type { CanvasEdge, CanvasNode, CanvasNodeType } from "@/types/domain";

export const DEFAULT_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  task_card: { width: 280, height: 160 },
  sticky_note: { width: 200, height: 120 },
  frame: { width: 400, height: 300 },
  doc_block: { width: 300, height: 150 },
};

const GAP = 24;
const FRAME_PADDING_X = 40;
const FRAME_HEADER = 80;

export interface Placement {
  id: string;
  x: number;
  y: number;
}

function sizeOf(node: CanvasNode) {
  const d = DEFAULT_SIZES[node.node_type] ?? { width: 200, height: 100 };
  return { width: node.width ?? d.width, height: node.height ?? d.height };
}

function isInside(node: CanvasNode, frame: CanvasNode): boolean {
  const f = sizeOf(frame);
  return (
    node.position_x >= frame.position_x &&
    node.position_y >= frame.position_y &&
    node.position_x < frame.position_x + f.width &&
    node.position_y < frame.position_y + f.height
  );
}

export function findInboxFrame(nodes: CanvasNode[]): CanvasNode | undefined {
  return nodes.find(
    (n) => n.node_type === "frame" && (n.data?.isAIInbox === true || n.data?.title === "Inbox da IA")
  );
}

/**
 * Calcula posições para nós com needs_auto_layout, sem sobrepor o que já está
 * posicionado. Ordem de preferência:
 *  1. frame indicado em parent_frame_id (ex.: agrupamento de post-its pela IA)
 *  2. ao lado do pai, quando há aresta parent_of chegando no nó
 *  3. empilhado dentro do "Inbox da IA", abaixo do último card já posicionado
 * Nós sem destino ficam de fora (o chamador usa ELK para eles).
 */
export function computePendingPlacements(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): { placements: Placement[]; unplaced: CanvasNode[] } {
  const pending = nodes.filter((n) => n.needs_auto_layout);
  const pendingIds = new Set(pending.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inbox = findInboxFrame(nodes);

  // Próximo y livre por frame (considera nós já posicionados dentro dele)
  const nextYByFrame = new Map<string, number>();
  const nextFreeY = (frame: CanvasNode): number => {
    const cached = nextYByFrame.get(frame.id);
    if (cached !== undefined) return cached;
    let bottom = frame.position_y + FRAME_HEADER - GAP;
    for (const n of nodes) {
      if (n.id === frame.id || pendingIds.has(n.id) || n.node_type === "frame") continue;
      if (n.parent_frame_id === frame.id || isInside(n, frame)) {
        bottom = Math.max(bottom, n.position_y + sizeOf(n).height);
      }
    }
    const y = bottom + GAP;
    nextYByFrame.set(frame.id, y);
    return y;
  };
  const stackInto = (frame: CanvasNode, node: CanvasNode): Placement => {
    const y = nextFreeY(frame);
    nextYByFrame.set(frame.id, y + sizeOf(node).height + GAP);
    return { id: node.id, x: frame.position_x + FRAME_PADDING_X, y };
  };

  // Filhos já posicionados ao lado de cada pai (para não empilhar no mesmo ponto)
  const siblingsPlaced = new Map<string, number>();

  const placements: Placement[] = [];
  const unplaced: CanvasNode[] = [];

  for (const node of pending) {
    const frame = node.parent_frame_id ? byId.get(node.parent_frame_id) : undefined;
    if (frame && frame.node_type === "frame") {
      placements.push(stackInto(frame, node));
      continue;
    }

    const parentEdge = edges.find((e) => e.target_node_id === node.id && e.edge_type === "parent_of");
    const parent = parentEdge ? byId.get(parentEdge.source_node_id) : undefined;
    if (parent && !pendingIds.has(parent.id)) {
      const index = siblingsPlaced.get(parent.id) ?? 0;
      siblingsPlaced.set(parent.id, index + 1);
      const p = sizeOf(parent);
      const s = sizeOf(node);
      placements.push({
        id: node.id,
        x: parent.position_x + p.width + 80,
        y: parent.position_y + index * (s.height + GAP),
      });
      continue;
    }

    if (inbox) {
      placements.push(stackInto(inbox, node));
      continue;
    }

    unplaced.push(node);
  }

  return { placements, unplaced };
}

/**
 * Eleição determinística de quem executa o auto-layout: o menor id entre os
 * usuários presentes. Evita N clientes calculando e gravando ao mesmo tempo.
 */
export function isLayoutLeader(currentUserId: string, presentUserIds: string[]): boolean {
  if (!currentUserId) return false;
  const all = [currentUserId, ...presentUserIds].filter(Boolean).sort();
  return all[0] === currentUserId;
}
