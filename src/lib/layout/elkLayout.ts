import type { ElkNode, ElkExtendedEdge, ElkEdgeSection } from "elkjs/lib/elk.bundled.js";
import { CanvasNode, CanvasEdge, CanvasNodeType } from "@/types/domain";

type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
let elkPromise: Promise<ElkInstance> | null = null;

/**
 * ELK (~400 kB) é carregado sob demanda, só quando um layout é pedido:
 * tira o peso do bundle inicial do canvas. Build bundled: sem dependência de 'web-worker'.
 */
function getElk(): Promise<ElkInstance> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then((mod) => {
      const Elk = (mod as unknown as { default: new () => ElkInstance }).default;
      return new Elk();
    });
  }
  return elkPromise;
}

export interface LayoutOptions {
  direction?: "DOWN" | "UP" | "LEFT" | "RIGHT";
  nodeSpacing?: number;
  edgeSpacing?: number;
  hierarchyHandling?: "INCLUDE_CHILDREN" | "SEPARATE_CHILDREN";
}

export interface LayoutResult {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  }>;
  edges: Array<{
    id: string;
    sections: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }>;
  }>;
}

/**
 * Converte nós e arestas do CanvasFlow para formato ELK
 */
function toElkGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  options: LayoutOptions = {}
): ElkNode {
  const nodeMap = new Map<string, ElkNode>();

  // Criar nós ELK
  for (const node of nodes) {
    const elkNode: ElkNode = {
      id: node.id,
      width: node.width || getDefaultWidth(node.node_type),
      height: node.height || getDefaultHeight(node.node_type),
      layoutOptions: {
        "elk.padding": "[top=20,left=20,bottom=20,right=20]",
      },
    };

    // Frames são containers
    if (node.node_type === "frame") {
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      };
    }

    nodeMap.set(node.id, elkNode);
  }

  // Adicionar filhos aos frames
  for (const node of nodes) {
    if (node.parent_frame_id && nodeMap.has(node.parent_frame_id)) {
      const parent = nodeMap.get(node.parent_frame_id)!;
      if (!parent.children) parent.children = [];
      parent.children.push(nodeMap.get(node.id)!);
    }
  }

  // Criar arestas ELK
  const elkEdges: ElkExtendedEdge[] = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source_node_id],
    targets: [edge.target_node_id],
    layoutOptions: {
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.edgeLabels.inline": "true",
    },
  }));

  // Nó raiz (canvas)
  const rootNodes = nodes.filter((n) => !n.parent_frame_id).map((n) => nodeMap.get(n.id)!);

  return {
    id: "canvas-root",
    children: rootNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": options.direction || "DOWN",
      "elk.spacing.nodeNode": String(options.nodeSpacing || 50),
      "elk.spacing.edgeEdge": String(options.edgeSpacing || 20),
      "elk.layered.nodePlacement.bk": "SIMPLE",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.hierarchyHandling": options.hierarchyHandling || "INCLUDE_CHILDREN",
      "elk.padding": "[top=50,left=50,bottom=50,right=50]",
    },
  };
}

function getDefaultWidth(type: CanvasNodeType): number {
  switch (type) {
    case "task_card":
      return 280;
    case "sticky_note":
      return 200;
    case "frame":
      return 400;
    case "doc_block":
      return 300;
    default:
      return 200;
  }
}

function getDefaultHeight(type: CanvasNodeType): number {
  switch (type) {
    case "task_card":
      return 160;
    case "sticky_note":
      return 120;
    case "frame":
      return 300;
    case "doc_block":
      return 150;
    default:
      return 100;
  }
}

/**
 * Calcula layout automático para nós que precisam de posicionamento
 */
export async function calculateAutoLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  options: LayoutOptions = {}
): Promise<LayoutResult> {
  // Handle empty nodes case
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const elkGraph = toElkGraph(nodes, edges, options);
  const layouted = await (await getElk()).layout(elkGraph);

  const result: LayoutResult = {
    nodes: [],
    edges: [],
  };

  // Extrair posições dos nós (incluindo filhos de frames)
  function extractNodes(elkNode: ElkNode, parentX = 0, parentY = 0, isRoot = true) {
    const x = (elkNode.x || 0) + parentX;
    const y = (elkNode.y || 0) + parentY;

    // Skip the root canvas node
    if (!isRoot) {
      result.nodes.push({
        id: elkNode.id,
        x,
        y,
        width: elkNode.width,
        height: elkNode.height,
      });
    }

    if (elkNode.children) {
      for (const child of elkNode.children) {
        extractNodes(child, x, y, false);
      }
    }
  }

  extractNodes(layouted);

  // Extrair seções das arestas
  if (layouted.edges) {
    for (const edge of layouted.edges) {
      const sections = edge.sections?.map((section: ElkEdgeSection) => ({
        startPoint: section.startPoint,
        endPoint: section.endPoint,
        bendPoints: section.bendPoints,
      })) || [];

      result.edges.push({
        id: edge.id,
        sections,
      });
    }
  }

  return result;
}
