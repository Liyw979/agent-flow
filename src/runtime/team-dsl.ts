import {
  assertNoAmbiguousTopologyTriggerRoutes,
  DEFAULT_ACTION_REQUIRED_MAX_ROUNDS,
  LANGGRAPH_END_NODE_ID,
  type AgentRecord,
  createTopologyLangGraphRecord,
  isDefaultTopologyTrigger,
  isActionRequiredTopologyTrigger,
  normalizeActionRequiredMaxRounds,
  normalizeInitialMessageAgentIds,
  parseInitialMessageRoutingFromDslInput,
  normalizeTopologyEdgeTrigger,
  type TopologyEdgeMessageMode,
  type TopologyLangGraphRecord,
  type TopologyNodeRecord,
  type TopologyRecord,
  type SpawnRule,
  usesOpenCodeBuiltinPrompt,
} from "@shared/types";
import { z } from "zod";

export interface TeamDslAgentRecord {
  id: string;
  prompt: string;
  writable: boolean;
  initialMessageRouting: TopologyNodeRecord["initialMessageRouting"];
}

interface GraphDslAgentNode {
  type: "agent";
  id: string;
  prompt: string;
  writable: boolean;
  initialMessage?: string | string[];
}

interface GraphDslSpawnNode {
  type: "spawn";
  id: string;
  graph: GraphDslGraph;
}

type GraphDslNode = GraphDslAgentNode | GraphDslSpawnNode;

interface GraphDslLink {
  from: string;
  to: string;
  trigger: string;
  message_type: TopologyEdgeMessageMode;
  maxTriggerRounds?: number;
}

export interface GraphDslGraph {
  entry: string;
  nodes: GraphDslNode[];
  links: GraphDslLink[];
}

export type TeamDslDefinition = GraphDslGraph;

export interface CompiledTeamDslAgent {
  id: string;
  prompt: string;
  templateName: string;
  isWritable: boolean;
}

export interface CompiledTeamDsl {
  agents: CompiledTeamDslAgent[];
  topology: TopologyRecord;
}

const GraphDslLinkSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  message_type: z.enum(["none", "last"]),
  maxTriggerRounds: z.number().finite().optional(),
}).strict().superRefine((value, ctx) => {
  let normalizedTrigger: string;
  try {
    normalizedTrigger = normalizeTopologyEdgeTrigger(value.trigger);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["trigger"],
      message: error instanceof Error ? error.message : "非法 trigger。",
    });
    return;
  }
  if (!isActionRequiredTopologyTrigger(normalizedTrigger, value.maxTriggerRounds) && value.maxTriggerRounds !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxTriggerRounds"],
      message: "只有 action-required trigger 才允许声明 maxTriggerRounds。",
    });
  }
});

const GraphDslAgentNodeSchema = z.object({
  type: z.literal("agent"),
  id: z.string(),
  prompt: z.string(),
  writable: z.boolean(),
  initialMessage: z.union([z.string(), z.array(z.string())]).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.initialMessage === undefined) {
    return;
  }
  try {
    normalizeInitialMessageAgentIds(value.initialMessage);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["initialMessage"],
      message: error instanceof Error ? error.message : "非法 initialMessage。",
    });
  }
});

const GraphDslNodeSchema = z.lazy(() =>
  z.union([
    GraphDslAgentNodeSchema,
    z.object({
      type: z.literal("spawn"),
      id: z.string(),
      graph: GraphDslGraphSchema,
    }).strict(),
  ]),
);

const GraphDslGraphSchema = z.lazy(() =>
  z.object({
    entry: z.string(),
    nodes: z.array(GraphDslNodeSchema),
    links: z.array(GraphDslLinkSchema),
  }).strict(),
) as z.ZodType<GraphDslGraph>;

function normalizeComparableAgents(agents: Array<{
  id: string;
  prompt: string;
  isWritable?: boolean;
}>) {
  return [...agents]
    .map((agent) => ({
      id: agent.id,
      prompt: agent.prompt,
      isWritable: agent.isWritable === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeComparableTopology(topology: TopologyRecord): TopologyRecord {
  return {
    nodes: [...topology.nodes],
    edges: topology.edges
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        trigger: edge.trigger,
        messageMode: edge.messageMode,
        ...(isActionRequiredTopologyTrigger(edge.trigger, edge.maxTriggerRounds)
          ? {
              maxTriggerRounds:
                edge.maxTriggerRounds === undefined
                  ? DEFAULT_ACTION_REQUIRED_MAX_ROUNDS
                  : normalizeActionRequiredMaxRounds(edge.maxTriggerRounds),
            }
          : {}),
      }))
      .sort((left, right) => {
        const leftKey = `${left.source}__${left.target}__${left.trigger}__${left.messageMode}__${String(left.maxTriggerRounds)}`;
        const rightKey = `${right.source}__${right.target}__${right.trigger}__${right.messageMode}__${String(right.maxTriggerRounds)}`;
        return leftKey.localeCompare(rightKey);
      }),
    ...(topology.langgraph
      ? { langgraph: normalizeComparableLangGraph(topology.langgraph) }
      : {}),
    nodeRecords: [...topology.nodeRecords].sort((left, right) => left.id.localeCompare(right.id)),
    ...(topology.spawnRules
      ? {
          spawnRules: [...topology.spawnRules].sort((left, right) => left.id.localeCompare(right.id)),
        }
      : {}),
  };
}

function normalizeComparableLangGraph(langgraph: TopologyLangGraphRecord): TopologyLangGraphRecord {
  return {
    start: {
      id: langgraph.start.id,
      targets: [...langgraph.start.targets].sort((left, right) => left.localeCompare(right)),
    },
    end: langgraph.end
      ? {
          id: langgraph.end.id,
          sources: [...langgraph.end.sources].sort((left, right) => left.localeCompare(right)),
          incoming: [...langgraph.end.incoming].sort((left, right) => {
            const leftKey = `${left.source}__${left.trigger}`;
            const rightKey = `${right.source}__${right.trigger}`;
            return leftKey.localeCompare(rightKey);
          }),
        }
      : null,
  };
}

export function matchesAppliedTeamDslAgents(
  currentAgents: AgentRecord[],
  compiled: CompiledTeamDsl,
): boolean {
  const comparableCurrentAgents = normalizeComparableAgents(currentAgents);
  const comparableCompiledAgents = normalizeComparableAgents(
    compiled.agents.map((agent) => ({
      id: agent.id,
      prompt: agent.prompt,
      isWritable: agent.isWritable,
    })),
  );

  return JSON.stringify(comparableCurrentAgents) === JSON.stringify(comparableCompiledAgents);
}

export function matchesAppliedTeamDslTopology(
  currentTopology: TopologyRecord,
  compiled: CompiledTeamDsl,
): boolean {
  const comparableCurrentTopology = normalizeComparableTopology(currentTopology);
  const comparableCompiledTopology = normalizeComparableTopology(compiled.topology);

  return JSON.stringify(comparableCurrentTopology) === JSON.stringify(comparableCompiledTopology);
}

function isBuiltinTemplateName(name: string): boolean {
  return usesOpenCodeBuiltinPrompt(name);
}

function compileAgentDefinition(agent: TeamDslAgentRecord): CompiledTeamDslAgent {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    throw new Error("DSL agent 定义必须使用对象格式，例如 { id: \"Build\" }。");
  }

  const name = agent.id.trim();
  if (!name) {
    throw new Error("DSL Agent 名称不能为空。");
  }

  const templateName = isBuiltinTemplateName(name) ? name : null;
  const prompt = agent.prompt.trim();
  if (!templateName && !prompt) {
    throw new Error(`DSL Agent ${name} 不是内置模板，必须提供 prompt。`);
  }

  if (usesOpenCodeBuiltinPrompt(name) && prompt) {
    throw new Error(`${name} 使用 OpenCode 内置 prompt，DSL 中不允许覆盖 prompt。`);
  }

  return {
    id: name,
    prompt,
    templateName: templateName || name,
    isWritable: agent.writable,
  };
}

function normalizeCompiledWritableAgents(agents: CompiledTeamDslAgent[]): CompiledTeamDslAgent[] {
  return agents.map((agent) => ({
    ...agent,
    isWritable: agent.isWritable === true,
  }));
}

function assertTopologyAgentsDeclared(
  compiledAgents: CompiledTeamDslAgent[],
  topology: TopologyRecord,
): void {
  const known = new Set([
    ...compiledAgents.map((agent) => agent.id),
    ...topology.nodeRecords.filter((node) => node.kind === "spawn").map((node) => node.id),
  ]);
  const allNodes = new Set<string>([
    ...topology.nodes,
    ...(topology.langgraph?.start.targets ?? []),
    ...(topology.langgraph?.end?.sources ?? []),
    ...topology.nodeRecords.map((node) => node.id),
    ...(topology.spawnRules?.flatMap((rule) => [
      rule.spawnNodeName,
      rule.sourceTemplateName,
      rule.reportToTemplateName,
      ...rule.spawnedAgents.map((agent) => agent.templateName),
    ].filter((value): value is string => typeof value === "string" && value.length > 0)) ?? []),
  ]);

  for (const nodeName of allNodes) {
    if (!known.has(nodeName)) {
      throw new Error(`DSL topology 引用了未声明的 Agent：${nodeName}`);
    }
  }
}

function formatZodIssuePath(path: (string | number)[]): string {
  if (path.length === 0) {
    return "团队拓扑 DSL";
  }
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return acc ? `${acc}.${segment}` : segment;
  }, "");
}

function translateZodExpectedType(expected: string): string {
  switch (expected) {
    case "string":
      return "字符串";
    case "array":
      return "数组";
    case "object":
      return "对象";
    case "boolean":
      return "布尔值";
    default:
      return expected;
  }
}

function isRootGraphShapeIssue(issue: z.ZodIssue): boolean {
  if (issue.path.length === 0) {
    return true;
  }
  if (issue.path.length !== 1) {
    return false;
  }
  const [head] = issue.path;
  return head === "entry" || head === "nodes" || head === "links";
}

function formatGraphDslParseError(error: z.ZodError): string {
  if (error.issues.some((issue) => isRootGraphShapeIssue(issue))) {
    return "团队拓扑 JSON5 只支持递归式 entry + nodes + links DSL。";
  }

  const issue = error.issues[0];
  if (!issue) {
    return "团队拓扑 JSON5 校验失败。";
  }
  const path = formatZodIssuePath(issue.path);
  if (
    issue.path.at(-1) === "type"
    && (
      issue.code === z.ZodIssueCode.invalid_union_discriminator
      || issue.message === "Invalid input"
    )
  ) {
    return `${path} 是节点判别字段，只允许 agent 或 spawn。`;
  }
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return `${path} 只允许 ${issue.options.join(" / ")}。`;
  }
  if (
    issue.code === z.ZodIssueCode.invalid_type
    && issue.path[0] === "links"
    && issue.expected === "object"
) {
    return `${formatZodIssuePath(issue.path)} 必须使用对象格式，并显式写出 from、to、trigger、message_type。`;
  }
  if (
    issue.code === z.ZodIssueCode.unrecognized_keys
    && issue.path[0] === "links"
  ) {
    return `${formatZodIssuePath(issue.path)} 只允许显式写出 from、to、trigger、message_type、maxTriggerRounds。`;
  }
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === "undefined") {
      return `${path} 必须显式写出，不能省略。`;
    }
    return `${path} 类型错误，期望 ${translateZodExpectedType(issue.expected)}。`;
  }
  return `${path} 校验失败：${issue.message}`;
}

function parseGraphDsl(input: unknown): GraphDslGraph {
  const parsed = GraphDslGraphSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(formatGraphDslParseError(parsed.error));
  }
  return parsed.data;
}

function mapGraphDslLinkToTopologyEdge(link: GraphDslLink) {
  const trigger = normalizeTopologyEdgeTrigger(link.trigger);
  return {
    source: link.from,
    target: link.to,
    trigger,
    messageMode: link.message_type,
    ...(isActionRequiredTopologyTrigger(trigger, link.maxTriggerRounds) && typeof link.maxTriggerRounds === "number"
      ? {
          maxTriggerRounds: normalizeActionRequiredMaxRounds(link.maxTriggerRounds),
        }
      : {}),
  };
}

function resolveSpawnReportTo(
  graph: GraphDslGraph,
  spawnNodeName: string,
): {
  target: string;
  trigger: string;
  messageMode: TopologyEdgeMessageMode;
  maxTriggerRounds?: number;
} | undefined {
  const outgoingLinks = graph.links.filter((link) => link.from === spawnNodeName);
  return outgoingLinks.length === 1
    ? {
        target: outgoingLinks[0]!.to,
        trigger: normalizeTopologyEdgeTrigger(outgoingLinks[0]!.trigger),
        messageMode: outgoingLinks[0]!.message_type,
        ...(isActionRequiredTopologyTrigger(
          normalizeTopologyEdgeTrigger(outgoingLinks[0]!.trigger),
          outgoingLinks[0]!.maxTriggerRounds,
        )
          && typeof outgoingLinks[0]!.maxTriggerRounds === "number"
          ? {
              maxTriggerRounds: normalizeActionRequiredMaxRounds(outgoingLinks[0]!.maxTriggerRounds),
            }
          : {}),
      }
    : undefined;
}

function resolveSpawnSourceTemplateName(
  graph: GraphDslGraph,
  spawnNodeName: string,
): string | undefined {
  const incomingLinks = graph.links.filter((link) => link.to === spawnNodeName);
  return incomingLinks.length === 1 ? incomingLinks[0]!.from : undefined;
}

function resolveGraphExternalReport(
  graph: GraphDslGraph,
  availableExternalTargets: ReadonlySet<string>,
): {
  source: string;
  target: string;
  trigger: string;
  messageMode: TopologyEdgeMessageMode;
  maxTriggerRounds?: number;
} | undefined {
  const localNames = new Set(graph.nodes.map((node) => node.id));
  const externalLinks = graph.links.filter((link) =>
    !localNames.has(link.to) && availableExternalTargets.has(link.to),
  );
  if (externalLinks.length === 0) {
    return undefined;
  }
  if (externalLinks.length > 1) {
    throw new Error("spawn 子图最多只能声明一条直接回到外层节点的出口。");
  }
  const externalLink = externalLinks[0]!;
  return {
    source: externalLink.from,
    target: externalLink.to,
    trigger: normalizeTopologyEdgeTrigger(externalLink.trigger),
    messageMode: externalLink.message_type,
    ...(isActionRequiredTopologyTrigger(normalizeTopologyEdgeTrigger(externalLink.trigger), externalLink.maxTriggerRounds)
      && typeof externalLink.maxTriggerRounds === "number"
      ? {
          maxTriggerRounds: normalizeActionRequiredMaxRounds(externalLink.maxTriggerRounds),
        }
      : {}),
  };
}

function collectGraphDslNodeDefinitions(
  graph: GraphDslGraph,
  context: {
    agentDefinitions: Map<string, TeamDslAgentRecord>;
    nodeRecords: Map<string, TopologyNodeRecord>;
    spawnRules: Map<string, SpawnRule>;
    isRootGraph: boolean;
    availableExternalTargets: ReadonlySet<string>;
  },
): void {
  const localNames = new Set<string>();
  for (const node of graph.nodes) {
    if (localNames.has(node.id)) {
      throw new Error(`同一层 graph 中存在重复节点名：${node.id}`);
    }
    localNames.add(node.id);
  }
  if (!localNames.has(graph.entry)) {
    throw new Error(`graph.entry 指向了不存在的节点：${graph.entry}`);
  }
  for (const link of graph.links) {
    const isDirectEndLink = context.isRootGraph && link.to === LANGGRAPH_END_NODE_ID;
    const isExternalTarget = !localNames.has(link.to) && context.availableExternalTargets.has(link.to);
    if (link.to === LANGGRAPH_END_NODE_ID && !isDirectEndLink) {
      throw new Error(`graph.links 只有根图可以直接连接 __end__：${link.from} -> ${link.to}`);
    }
    if (!localNames.has(link.from) || (!localNames.has(link.to) && !isDirectEndLink && !isExternalTarget)) {
      throw new Error(`graph.links 引用了不存在的节点：${link.from} -> ${link.to}`);
    }
  }

  for (const node of graph.nodes) {
    if (context.nodeRecords.has(node.id)) {
      throw new Error(`DSL 节点名必须全局唯一：${node.id}`);
    }

    const parsedNode =
      node.type === "agent"
        ? {
            type: "agent" as const,
            id: node.id,
            prompt: node.prompt,
            writable: node.writable,
            initialMessageRouting: parseInitialMessageRoutingFromDslInput(
              node.initialMessage,
            ),
          }
        : node;

    if (parsedNode.type === "agent") {
      context.agentDefinitions.set(node.id, {
        id: parsedNode.id,
        prompt: parsedNode.prompt,
        writable: parsedNode.writable,
        initialMessageRouting: parsedNode.initialMessageRouting,
      });
      context.nodeRecords.set(parsedNode.id, {
        id: parsedNode.id,
        kind: "agent",
        templateName: parsedNode.id,
        initialMessageRouting: parsedNode.initialMessageRouting,
      });
      continue;
    }

    const spawnRuleId = `spawn-rule:${parsedNode.id}`;
    const reportTarget = resolveSpawnReportTo(graph, parsedNode.id);
    const sourceTemplateName = resolveSpawnSourceTemplateName(graph, parsedNode.id);
    const childAvailableExternalTargets = new Set([
      ...context.availableExternalTargets,
      ...localNames,
    ]);
    const externalReportTarget = resolveGraphExternalReport(parsedNode.graph, childAvailableExternalTargets);
    if (reportTarget && externalReportTarget) {
      throw new Error(`spawn 节点 ${node.id} 不能同时在外层和子图里声明回到外层的出口。`);
    }
    const reportToTemplateName = externalReportTarget?.target ?? reportTarget?.target;
    const reportToTrigger = externalReportTarget?.trigger ?? reportTarget?.trigger;
    const reportToMessageMode = externalReportTarget?.messageMode ?? reportTarget?.messageMode;
    const reportToMaxTriggerRounds = externalReportTarget?.maxTriggerRounds ?? reportTarget?.maxTriggerRounds;
    if (reportToTemplateName && !reportToTrigger) {
      throw new Error(`spawn 节点 ${parsedNode.id} 存在回到外层的目标时，必须显式声明 trigger。`);
    }
    context.nodeRecords.set(parsedNode.id, {
      id: parsedNode.id,
      kind: "spawn",
      templateName: parsedNode.id,
      initialMessageRouting: { mode: "inherit" },
      spawnEnabled: true,
      spawnRuleId,
    });
    collectGraphDslNodeDefinitions(parsedNode.graph, {
      ...context,
      isRootGraph: false,
      availableExternalTargets: childAvailableExternalTargets,
    });
    context.spawnRules.set(spawnRuleId, {
      id: spawnRuleId,
      spawnNodeName: parsedNode.id,
      ...(sourceTemplateName ? { sourceTemplateName } : {}),
      entryRole: parsedNode.graph.entry,
      spawnedAgents: parsedNode.graph.nodes.map((childNode) => ({
        role: childNode.id,
        templateName: childNode.id,
      })),
      edges: parsedNode.graph.links
        .filter((link) => parsedNode.graph.nodes.some((childNode) => childNode.id === link.to))
        .map((link) => ({
          sourceRole: link.from,
          targetRole: link.to,
          trigger: normalizeTopologyEdgeTrigger(link.trigger),
          messageMode: link.message_type,
          ...(isActionRequiredTopologyTrigger(normalizeTopologyEdgeTrigger(link.trigger), link.maxTriggerRounds)
            && typeof link.maxTriggerRounds === "number"
            ? {
                maxTriggerRounds: normalizeActionRequiredMaxRounds(link.maxTriggerRounds),
              }
            : {}),
        })),
      exitWhen: "all_completed",
      ...(reportToTemplateName ? { reportToTemplateName } : {}),
      ...(reportToTrigger ? { reportToTrigger } : {}),
      ...(reportToMessageMode ? { reportToMessageMode } : {}),
      ...(reportToTrigger && isActionRequiredTopologyTrigger(reportToTrigger, reportToMaxTriggerRounds)
        && typeof reportToMaxTriggerRounds === "number"
        ? { reportToMaxTriggerRounds }
        : {}),
    });
  }
}

function collectGraphDslEndLinks(graph: GraphDslGraph): GraphDslLink[] {
  return graph.links
    .filter((link) => link.to === LANGGRAPH_END_NODE_ID)
    .filter((value, index, list) =>
      list.findIndex((item) =>
        item.from === value.from
        && normalizeTopologyEdgeTrigger(item.trigger) === normalizeTopologyEdgeTrigger(value.trigger)
        && item.message_type === value.message_type
      ) === index);
}

function assertGraphAgentPromptsDeclareOutgoingTriggers(graph: GraphDslGraph): void {
  const agentPrompts = new Map(
    graph.nodes
      .filter((node): node is GraphDslAgentNode => node.type === "agent")
      .map((node) => [node.id, node.prompt]),
  );
  const triggersBySource = new Map<string, Set<string>>();

  for (const link of graph.links) {
    if (!agentPrompts.has(link.from)) {
      continue;
    }
    const trigger = normalizeTopologyEdgeTrigger(link.trigger);
    if (isDefaultTopologyTrigger(trigger)) {
      continue;
    }
    const current = triggersBySource.get(link.from) ?? new Set<string>();
    current.add(trigger);
    triggersBySource.set(link.from, current);
  }

  for (const [agentId, triggers] of triggersBySource.entries()) {
    const prompt = agentPrompts.get(agentId);
    if (prompt === undefined) {
      continue;
    }
    const missingTriggers = [...triggers].filter((trigger) => !prompt.includes(trigger));
    if (missingTriggers.length > 0) {
      throw new Error(`DSL Agent ${agentId} 的 prompt 必须显式包含以下 trigger：${missingTriggers.join("、")}`);
    }
  }

  for (const node of graph.nodes) {
    if (node.type === "spawn") {
      assertGraphAgentPromptsDeclareOutgoingTriggers(node.graph);
    }
  }
}

function assertGraphInitialMessageSourcesExist(graph: GraphDslGraph): void {
  const localAgentIds = new Set(
    graph.nodes
      .filter((node): node is GraphDslAgentNode => node.type === "agent")
      .map((node) => node.id),
  );
  const visibleAgentIds = new Set(localAgentIds);
  for (const node of graph.nodes) {
    if (node.type === "spawn") {
      continue;
    }
    visibleAgentIds.add(node.id);
  }
  for (const node of graph.nodes) {
    if (node.type === "agent") {
      const routing = parseInitialMessageRoutingFromDslInput(node.initialMessage);
      if (routing.mode === "list") {
        for (const agentId of routing.agentIds) {
          if (!visibleAgentIds.has(agentId)) {
            throw new Error(
              `DSL Agent ${node.id} 的 initialMessage 引用了不存在的来源 Agent：${agentId}`,
            );
          }
        }
      }
      continue;
    }
    const childVisibleAgentIds = new Set(visibleAgentIds);
    for (const childNode of node.graph.nodes) {
      if (childNode.type === "agent") {
        childVisibleAgentIds.add(childNode.id);
      }
    }
    assertGraphInitialMessageSourcesExistWithVisibleSources(
      node.graph,
      childVisibleAgentIds,
    );
  }
}

function assertGraphInitialMessageSourcesExistWithVisibleSources(
  graph: GraphDslGraph,
  visibleAgentIds: ReadonlySet<string>,
): void {
  const localAgentIds = new Set(
    graph.nodes
      .filter((node): node is GraphDslAgentNode => node.type === "agent")
      .map((node) => node.id),
  );
  const nextVisibleAgentIds = new Set(visibleAgentIds);
  for (const agentId of localAgentIds) {
    nextVisibleAgentIds.add(agentId);
  }
  for (const node of graph.nodes) {
    if (node.type === "agent") {
      const routing = parseInitialMessageRoutingFromDslInput(node.initialMessage);
      if (routing.mode === "list") {
        for (const agentId of routing.agentIds) {
          if (!nextVisibleAgentIds.has(agentId)) {
            throw new Error(
              `DSL Agent ${node.id} 的 initialMessage 引用了不存在的来源 Agent：${agentId}`,
            );
          }
        }
      }
      continue;
    }
    assertGraphInitialMessageSourcesExistWithVisibleSources(
      node.graph,
      nextVisibleAgentIds,
    );
  }
}

function compileGraphDsl(input: GraphDslGraph): CompiledTeamDsl {
  assertGraphAgentPromptsDeclareOutgoingTriggers(input);
  assertGraphInitialMessageSourcesExist(input);
  const agentDefinitions = new Map<string, TeamDslAgentRecord>();
  const nodeRecords = new Map<string, TopologyNodeRecord>();
  const spawnRules = new Map<string, SpawnRule>();
  collectGraphDslNodeDefinitions(input, {
    agentDefinitions,
    nodeRecords,
    spawnRules,
    isRootGraph: true,
    availableExternalTargets: new Set<string>(),
  });

  const compiledAgents = normalizeCompiledWritableAgents(
    [...agentDefinitions.values()].map((agent) => compileAgentDefinition(agent)),
  );
  const compiledAgentsByName = new Map(compiledAgents.map((agent) => [agent.id, agent]));
  const compiledNodeRecords = [...nodeRecords.values()].map((node) => {
    if (node.kind !== "agent") {
      return { ...node };
    }
    const compiledAgent = compiledAgentsByName.get(node.id);
    return {
      ...node,
      ...(compiledAgent?.prompt !== null && compiledAgent?.prompt !== undefined
        ? { prompt: compiledAgent.prompt }
        : {}),
      ...(compiledAgent?.isWritable === true ? { writable: true } : {}),
    };
  });
  const nonEndLinks = input.links.filter((link) => link.to !== LANGGRAPH_END_NODE_ID);
  const topologyEdges = nonEndLinks.map((link) => mapGraphDslLinkToTopologyEdge(link));
  const endLinks = collectGraphDslEndLinks(input);

  const topology: TopologyRecord = {
    nodes: input.nodes.map((node) => node.id),
    edges: topologyEdges,
    langgraph: createTopologyLangGraphRecord({
      nodes: input.nodes.map((node) => node.id),
      edges: topologyEdges,
      startTargets: [input.entry],
      endIncoming: endLinks.map((link) => ({
        source: link.from,
        trigger: normalizeTopologyEdgeTrigger(link.trigger),
      })),
    }),
    nodeRecords: compiledNodeRecords,
    spawnRules: [...spawnRules.values()],
  };
  assertTopologyAgentsDeclared(compiledAgents, topology);
  assertNoAmbiguousTopologyTriggerRoutes({
    edges: topology.edges,
    endIncoming: topology.langgraph?.end?.incoming ?? [],
  });

  return {
    agents: compiledAgents,
    topology,
  };
}

export function compileTeamDsl(input: unknown): CompiledTeamDsl {
  return compileGraphDsl(parseGraphDsl(input));
}

export function matchesAppliedTeamDsl(
  currentAgents: AgentRecord[],
  currentTopology: TopologyRecord,
  compiled: CompiledTeamDsl,
): boolean {
  if (!matchesAppliedTeamDslAgents(currentAgents, compiled)) {
    return false;
  }
  return matchesAppliedTeamDslTopology(currentTopology, compiled);
}

export function toAgentRecord(agent: CompiledTeamDslAgent): AgentRecord {
  return {
    id: agent.id,
    prompt: agent.prompt,
    isWritable: agent.isWritable,
  };
}
