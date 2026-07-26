// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { getDagreLayout, resolveNodeCollisions } from "./topology-layout";

describe("topology layout boundaries", () => {
  test("dagre preserves node identity and lays out connected nodes", () => {
    const inputNodes = [
      { id: "source", position: { x: 0, y: 0 }, data: {} },
      { id: "target", position: { x: 0, y: 0 }, data: {} },
    ];
    const inputEdges = [
      { id: "source-target", source: "source", target: "target" },
    ];

    const result = getDagreLayout(inputNodes, inputEdges);

    expect(result.nodes.map((node) => node.id)).toEqual(["source", "target"]);
    expect(result.nodes[0]?.position).not.toEqual(result.nodes[1]?.position);
    expect(result.edges).toEqual(inputEdges);
  });

  test("collision resolution returns the same node set with finite positions", () => {
    const inputNodes = [
      { id: "one", position: { x: 0, y: 0 }, data: {} },
      { id: "two", position: { x: 0, y: 0 }, data: {} },
    ];

    const result = resolveNodeCollisions(inputNodes);

    expect(result.map((node) => node.id)).toEqual(["one", "two"]);
    for (const node of result) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });
});
