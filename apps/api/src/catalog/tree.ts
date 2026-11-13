/**
 * Category tree rules (DP-033), checked in code before a write so the client gets a precise
 * validation error. The database trigger `catalog_category_tree_guard` enforces the same rules.
 */
export interface TreeNode {
  id: string;
  parentId: string | null;
}

export const MAX_DEPTH = 3;

/** The node and all its descendants. */
export function subtreeIds(nodes: readonly TreeNode[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n.id);
    children.set(n.parentId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Levels from the root down to the node (a root category is 1); Infinity on a broken chain. */
export function depthOf(nodes: readonly TreeNode[], id: string): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let depth = 0;
  let current: string | null = id;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return Infinity;
    seen.add(current);
    const node = byId.get(current);
    if (!node) return Infinity;
    depth++;
    current = node.parentId;
  }
  return depth;
}

/** Levels of the node's own subtree (a leaf is 1). */
export function subtreeHeight(nodes: readonly TreeNode[], id: string): number {
  const children = nodes.filter((n) => n.parentId === id);
  return 1 + Math.max(0, ...children.map((c) => subtreeHeight(nodes, c.id)));
}

export type ParentProblem = "unknown_parent" | "cycle" | "too_deep" | null;

/**
 * Whether `nodeId` (null for a new category) may sit below `parentId` in `nodes` (the site's
 * categories, before the change).
 */
export function parentProblem(
  nodes: readonly TreeNode[],
  nodeId: string | null,
  parentId: string | null,
): ParentProblem {
  if (!parentId) return null;
  if (!nodes.some((n) => n.id === parentId)) return "unknown_parent";
  if (nodeId && subtreeIds(nodes, nodeId).includes(parentId)) return "cycle";
  const height = nodeId ? subtreeHeight(nodes, nodeId) : 1;
  return depthOf(nodes, parentId) + height > MAX_DEPTH ? "too_deep" : null;
}
