export interface TopologyCanvasNodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TopologyCanvasLayout {
  width: number;
  height: number;
  nodes: TopologyCanvasNodeLayout[];
  edges: [];
}

export function buildTopologyCanvasLayout(input: {
  nodes: string[];
  edges: Array<unknown>;
  availableWidth?: number;
  availableHeight?: number;
  columnWidth?: number;
  columnGap?: number;
  sidePadding?: number;
  topPadding?: number;
  bottomPadding?: number;
  nodeHeight?: number;
  minNodeWidth?: number;
  minNodeHeight?: number;
}): TopologyCanvasLayout {
  const fallbackNodeWidth = input.columnWidth ?? 260;
  const columnGap = input.columnGap ?? 36;
  const sidePadding = input.sidePadding ?? 28;
  const topPadding = input.topPadding ?? 22;
  const bottomPadding = input.bottomPadding ?? 20;
  const fallbackNodeHeight = input.nodeHeight ?? 308;
  const minNodeWidth = input.minNodeWidth ?? fallbackNodeWidth;
  const minNodeHeight = input.minNodeHeight ?? fallbackNodeHeight;
  const availableWidth = input.availableWidth;
  const availableHeight = input.availableHeight;
  const nodeCount = Math.max(1, input.nodes.length);
  const stretchedNodeWidth = availableWidth
    ? (availableWidth - sidePadding * 2 - Math.max(0, nodeCount - 1) * columnGap) / nodeCount
    : null;
  const useStretchedWidth = stretchedNodeWidth !== null && stretchedNodeWidth >= minNodeWidth;
  const nodeWidth = useStretchedWidth ? stretchedNodeWidth : fallbackNodeWidth;
  const stretchedNodeHeight = availableHeight
    ? availableHeight - topPadding - bottomPadding
    : null;
  const useStretchedHeight = stretchedNodeHeight !== null && stretchedNodeHeight >= minNodeHeight;
  const nodeHeight = useStretchedHeight ? stretchedNodeHeight : fallbackNodeHeight;
  const nodeY = topPadding;
  const width = useStretchedWidth
    ? availableWidth!
    : nodeCount * nodeWidth + Math.max(0, nodeCount - 1) * columnGap + sidePadding * 2;
  const height = useStretchedHeight
    ? availableHeight!
    : nodeY + nodeHeight + bottomPadding;

  const nodes = input.nodes.map((id, index) => {
    const x = sidePadding + index * (nodeWidth + columnGap);
    return {
      id,
      x,
      y: nodeY,
      width: nodeWidth,
      height: nodeHeight,
    } satisfies TopologyCanvasNodeLayout;
  });

  return {
    width,
    height,
    nodes,
    edges: [],
  };
}
