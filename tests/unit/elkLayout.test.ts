import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateAutoLayout,
  positionNodesAroundParent,
  positionNodesInFrame,
} from "@/lib/layout/elkLayout";
import { CanvasNode, CanvasEdge, CanvasNodeType, CanvasEdgeType } from "@/types/domain";

// Mock ELK (mesmo caminho do import em src/lib/layout/elkLayout.ts)
vi.mock("elkjs/lib/elk.bundled.js", () => {
  const mockLayoutResult = {
    id: "canvas-root",
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
    children: [
      {
        id: "node-1",
        x: 100,
        y: 100,
        width: 280,
        height: 160,
      },
      {
        id: "node-2",
        x: 450,
        y: 100,
        width: 280,
        height: 160,
      },
    ],
    edges: [
      {
        id: "edge-1",
        sections: [
          {
            startPoint: { x: 380, y: 180 },
            endPoint: { x: 450, y: 180 },
            bendPoints: [],
          },
        ],
      },
    ],
  };

  const mockElk = {
    // O mock reflete as arestas do grafo de entrada (como o ELK real):
    // sem arestas de entrada, nenhuma seção é devolvida
    layout: vi.fn((graph: { edges?: Array<{ id: string }> }) =>
      Promise.resolve({
        ...mockLayoutResult,
        edges: (graph.edges ?? []).map((edge) => ({
          id: edge.id,
          sections: [
            {
              startPoint: { x: 380, y: 180 },
              endPoint: { x: 450, y: 180 },
              bendPoints: [],
            },
          ],
        })),
      })
    ),
  };

  return {
    default: vi.fn().mockImplementation(() => mockElk),
    ElkConstructor: vi.fn().mockImplementation(() => mockElk),
  };
});

const mockNodes: CanvasNode[] = [
  {
    id: "node-1",
    canvas_id: "canvas-1",
    node_type: "task_card",
    task_id: "task-1",
    parent_frame_id: null,
    position_x: 0,
    position_y: 0,
    width: 280,
    height: 160,
    z_index: 0,
    needs_auto_layout: true,
    data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "node-2",
    canvas_id: "canvas-1",
    node_type: "task_card",
    task_id: "task-2",
    parent_frame_id: null,
    position_x: 0,
    position_y: 0,
    width: 280,
    height: 160,
    z_index: 0,
    needs_auto_layout: true,
    data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockEdges: CanvasEdge[] = [
  {
    id: "edge-1",
    canvas_id: "canvas-1",
    source_node_id: "node-1",
    target_node_id: "node-2",
    edge_type: "parent_of",
    label: null,
    created_at: new Date().toISOString(),
  },
];

const mockFrameNode: CanvasNode = {
  id: "frame-1",
  canvas_id: "canvas-1",
  node_type: "frame",
  task_id: null,
  parent_frame_id: null,
  position_x: 100,
  position_y: 100,
  width: 600,
  height: 400,
  z_index: 0,
  needs_auto_layout: false,
  data: { title: "Sprint 1" },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockChildNodes: CanvasNode[] = [
  {
    id: "child-1",
    canvas_id: "canvas-1",
    node_type: "task_card",
    task_id: "task-1",
    parent_frame_id: "frame-1",
    position_x: 0,
    position_y: 0,
    width: 280,
    height: 160,
    z_index: 0,
    needs_auto_layout: true,
    data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "child-2",
    canvas_id: "canvas-1",
    node_type: "task_card",
    task_id: "task-2",
    parent_frame_id: "frame-1",
    position_x: 0,
    position_y: 0,
    width: 280,
    height: 160,
    z_index: 0,
    needs_auto_layout: true,
    data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "child-3",
    canvas_id: "canvas-1",
    node_type: "sticky_note",
    task_id: null,
    parent_frame_id: "frame-1",
    position_x: 0,
    position_y: 0,
    width: 200,
    height: 120,
    z_index: 0,
    needs_auto_layout: true,
    data: { color: "#fef9c3", text: "Nota" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe("elkLayout", () => {
  describe("calculateAutoLayout", () => {
    it("should return positioned nodes and edges", async () => {
      const result = await calculateAutoLayout(mockNodes, mockEdges);

      expect(result).toHaveProperty("nodes");
      expect(result).toHaveProperty("edges");
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);

      expect(result.nodes[0]).toHaveProperty("id", "node-1");
      expect(result.nodes[0]).toHaveProperty("x");
      expect(result.nodes[0]).toHaveProperty("y");
    });

    it("should handle empty nodes array", async () => {
      const result = await calculateAutoLayout([], []);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it("should handle nodes without edges", async () => {
      const result = await calculateAutoLayout(mockNodes, []);
      expect(result.nodes).toHaveLength(2);
      // Sem arestas de entrada, nenhuma seção de aresta é extraída
      expect(result.edges).toHaveLength(0);
    });
  });

  describe("positionNodesAroundParent", () => {
    it("should position children around parent node", () => {
      const parent: CanvasNode = {
        ...mockNodes[0],
        id: "parent-1",
        position_x: 100,
        position_y: 100,
        width: 280,
        height: 160,
      };

      const children: CanvasNode[] = [
        { ...mockNodes[0], id: "child-1", position_x: 0, position_y: 0 },
        { ...mockNodes[0], id: "child-2", position_x: 0, position_y: 0 },
        { ...mockNodes[0], id: "child-3", position_x: 0, position_y: 0 },
        { ...mockNodes[0], id: "child-4", position_x: 0, position_y: 0 },
        { ...mockNodes[0], id: "child-5", position_x: 0, position_y: 0 }, // 5th should wrap
      ];

      const result = positionNodesAroundParent(parent, children);

      expect(result).toHaveLength(5);

      // Primeiro filho à direita
      expect(result[0].x).toBeGreaterThan(parent.position_x + parent.width!);
      expect(result[0].y).toBe(parent.position_y);

      // Segundo filho abaixo
      expect(result[1].x).toBe(parent.position_x);
      expect(result[1].y).toBeGreaterThan(parent.position_y + parent.height!);

      // Quinto filho deve voltar para a direita (wrap)
      expect(result[4].x).toBeGreaterThan(parent.position_x + parent.width!);
    });

    it("should handle empty children array", () => {
      const parent: CanvasNode = {
        ...mockNodes[0],
        id: "parent-1",
        position_x: 100,
        position_y: 100,
      };

      const result = positionNodesAroundParent(parent, []);
      expect(result).toHaveLength(0);
    });
  });

  describe("positionNodesInFrame", () => {
    it("should position children in a grid inside frame", () => {
      const frame: CanvasNode = {
        ...mockFrameNode,
        position_x: 100,
        position_y: 100,
        width: 600,
        height: 400,
      };

      const result = positionNodesInFrame(frame, mockChildNodes);

      expect(result).toHaveLength(3);

      // Todos devem estar dentro dos bounds do frame
      for (const node of result) {
        expect(node.x).toBeGreaterThanOrEqual(frame.position_x);
        expect(node.x).toBeLessThan(frame.position_x + frame.width!);
        expect(node.y).toBeGreaterThanOrEqual(frame.position_y);
        expect(node.y).toBeLessThan(frame.position_y + frame.height!);
      }

      // Deve haver espaçamento entre nós
      expect(result[1].x).toBeGreaterThan(result[0].x);
    });

    it("should handle empty children array", () => {
      const frame: CanvasNode = {
        ...mockFrameNode,
        position_x: 100,
        position_y: 100,
      };

      const result = positionNodesInFrame(frame, []);
      expect(result).toHaveLength(0);
    });

    it("should respect custom padding and spacing", () => {
      const frame: CanvasNode = {
        ...mockFrameNode,
        position_x: 0,
        position_y: 0,
        width: 400,
        height: 300,
      };

      const result = positionNodesInFrame(frame, mockChildNodes, 80, 40);

      // Com padding maior, nós devem começar mais longe da borda
      expect(result[0].x).toBeGreaterThanOrEqual(80);
      expect(result[0].y).toBeGreaterThanOrEqual(80);
    });
  });
});