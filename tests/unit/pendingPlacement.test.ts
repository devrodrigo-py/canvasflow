import { describe, it, expect } from "vitest";
import { computePendingPlacements, isLayoutLeader } from "@/lib/layout/pendingPlacement";
import type { CanvasEdge, CanvasNode } from "@/types/domain";

function node(partial: Partial<CanvasNode> & Pick<CanvasNode, "id" | "node_type">): CanvasNode {
  return {
    canvas_id: "c",
    task_id: null,
    parent_frame_id: null,
    position_x: 0,
    position_y: 0,
    width: null,
    height: null,
    z_index: 0,
    needs_auto_layout: false,
    data: {},
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

function edge(source: string, target: string, type: CanvasEdge["edge_type"] = "parent_of"): CanvasEdge {
  return {
    id: `${source}-${target}`,
    canvas_id: "c",
    source_node_id: source,
    target_node_id: target,
    edge_type: type,
    label: null,
    created_at: "",
  };
}

const inbox = node({
  id: "inbox",
  node_type: "frame",
  position_x: 100,
  position_y: 100,
  width: 800,
  height: 600,
  data: { isAIInbox: true },
});

describe("computePendingPlacements", () => {
  it("empilha cards do MCP no Inbox sem sobrepor (criados um a um)", () => {
    // Primeiro card chega e é posicionado
    const first = node({ id: "a", node_type: "task_card", needs_auto_layout: true });
    const r1 = computePendingPlacements([inbox, first], []);
    expect(r1.placements).toHaveLength(1);
    const placedFirst = { ...first, position_x: r1.placements[0].x, position_y: r1.placements[0].y, needs_auto_layout: false };

    // Segundo card chega depois: deve ir ABAIXO do primeiro, não no mesmo ponto
    const second = node({ id: "b", node_type: "task_card", needs_auto_layout: true });
    const r2 = computePendingPlacements([inbox, placedFirst, second], []);
    expect(r2.placements[0].y).toBeGreaterThanOrEqual(placedFirst.position_y + 160);
    expect(r2.placements[0].x).toBe(placedFirst.position_x);
  });

  it("vários pendentes no mesmo lote não se sobrepõem", () => {
    const pending = ["a", "b", "c"].map((id) => node({ id, node_type: "task_card", needs_auto_layout: true }));
    const { placements } = computePendingPlacements([inbox, ...pending], []);
    const ys = placements.map((p) => p.y);
    expect(new Set(ys).size).toBe(3);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(160);
  });

  it("posiciona filhos ao lado do pai, um abaixo do outro", () => {
    const parent = node({ id: "p", node_type: "task_card", position_x: 1000, position_y: 1000 });
    const c1 = node({ id: "c1", node_type: "task_card", needs_auto_layout: true });
    const c2 = node({ id: "c2", node_type: "task_card", needs_auto_layout: true });
    const { placements } = computePendingPlacements([inbox, parent, c1, c2], [edge("p", "c1"), edge("p", "c2")]);
    expect(placements[0]).toMatchObject({ id: "c1", x: 1000 + 280 + 80, y: 1000 });
    expect(placements[1].y).toBeGreaterThan(placements[0].y);
  });

  it("respeita parent_frame_id (agrupamento da IA)", () => {
    const frame = node({ id: "f", node_type: "frame", position_x: 2000, position_y: 0, width: 800, height: 400 });
    const sticky = node({ id: "s", node_type: "sticky_note", needs_auto_layout: true, parent_frame_id: "f" });
    const { placements } = computePendingPlacements([inbox, frame, sticky], []);
    expect(placements[0].x).toBe(2040);
  });

  it("sem inbox nem pai, devolve o nó como não posicionado (vai para o ELK)", () => {
    const lone = node({ id: "x", node_type: "task_card", needs_auto_layout: true });
    const { placements, unplaced } = computePendingPlacements([lone], []);
    expect(placements).toHaveLength(0);
    expect(unplaced.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("isLayoutLeader", () => {
  it("elege o menor id entre os presentes", () => {
    expect(isLayoutLeader("b", ["c", "a"])).toBe(false);
    expect(isLayoutLeader("a", ["c", "b"])).toBe(true);
    expect(isLayoutLeader("a", [])).toBe(true);
    expect(isLayoutLeader("", ["a"])).toBe(false);
  });
});
