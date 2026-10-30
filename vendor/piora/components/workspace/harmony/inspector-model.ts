import type { HarmonyUiNode } from "@/lib/harmony/types";
import type { HarmonyGeometry } from "@/lib/harmony/observation/geometry";

export function nodeAncestors(
  node: HarmonyUiNode,
  byRef: Map<string, HarmonyUiNode>,
) {
  const result: HarmonyUiNode[] = [],
    seen = new Set([node.ref]);
  let current = node;
  while (current.parentRef && !seen.has(current.parentRef)) {
    const parent = byRef.get(current.parentRef);
    if (!parent) break;
    result.push(parent);
    seen.add(parent.ref);
    current = parent;
  }
  return result;
}
export function frameBounds(node: HarmonyUiNode, geometry?: HarmonyGeometry) {
  const b = node.bounds;
  if (
    !b ||
    !geometry ||
    ![b.left, b.top, b.right, b.bottom].every(Number.isFinite) ||
    b.right <= b.left ||
    b.bottom <= b.top
  )
    return null;
  const { crop, frameWidth: w, frameHeight: h, rotation } = geometry;
  if (crop.width <= 0 || crop.height <= 0 || w <= 0 || h <= 0) return null;
  const points = [
    [b.left, b.top],
    [b.right, b.top],
    [b.left, b.bottom],
    [b.right, b.bottom],
  ].map(([x, y]) => {
    let u = (x - crop.left) / crop.width,
      v = (y - crop.top) / crop.height;
    if (rotation === 90) [u, v] = [1 - v, u];
    else if (rotation === 180) [u, v] = [1 - u, 1 - v];
    else if (rotation === 270) [u, v] = [v, 1 - u];
    return [u * w, v * h];
  });
  const left = Math.max(0, Math.min(...points.map((p) => p[0]))),
    top = Math.max(0, Math.min(...points.map((p) => p[1])));
  const right = Math.min(w, Math.max(...points.map((p) => p[0]))),
    bottom = Math.min(h, Math.max(...points.map((p) => p[1])));
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}
export function hitNodes(
  nodes: HarmonyUiNode[],
  geometry: HarmonyGeometry | undefined,
  x: number,
  y: number,
) {
  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  return nodes
    .filter((n) => n.visible !== false)
    .map((n) => ({ node: n, b: frameBounds(n, geometry) }))
    .filter(
      ({ b }) => b && x >= b.left && x < b.right && y >= b.top && y < b.bottom,
    )
    .sort(
      (a, b) =>
        nodeAncestors(b.node, byRef).length -
          nodeAncestors(a.node, byRef).length ||
        (a.b!.right - a.b!.left) * (a.b!.bottom - a.b!.top) -
          (b.b!.right - b.b!.left) * (b.b!.bottom - b.b!.top),
    )
    .map((item) => item.node);
}
