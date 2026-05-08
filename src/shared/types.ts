export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "action_required";

export type TaskStatus =
  | "pending"
  | "running"
  | "finished"
  | "failed"
  | "action_required";

export type AgentRoutingKind = "default" | "labeled" | "invalid";

export type PermissionMode = "allow" | "ask" | "deny";

const BUILD_AGENT_ID = "Build";

export function usesOpenCodeBuiltinPrompt(agentId: string): boolean {
  return agentId.trim().toLowerCase() === BUILD_AGENT_ID.toLowerCase();
}

export function getWorkspaceNameFromPath(workspacePath: string): string {
  const normalized = workspacePath.trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  cwd: string;
  agentCount: number;
  createdAt: string;
  completedAt: string;
  initializedAt: string;
}

export interface AgentRecord {
  id: string;
  prompt: string;
  isWritable: boolean;
}

export interface TopologyAgentSeed {
  id: string;
}

export type TopologyNodeKind = "agent" | "spawn";

export type SpawnedAgentRole = "pro" | "con" | "summary" | string;
export type InitialMessageRouting =
  | {
      mode: "inherit";
    }
  | {
      mode: "none";
    }
  | {
      mode: "list";
      agentIds: string[];
    };

function buildTopologyTrigger(name: string): TopologyTrigger {
  return `<${name}>`;
}

export const DEFAULT_TOPOLOGY_TRIGGER = buildTopologyTrigger("default");

export interface SpawnedAgentTemplate {
  role: SpawnedAgentRole;
  templateName: string;
}

interface SpawnRuleBase {
  id: string;
  spawnNodeName?: string;
  sourceTemplateName?: string;
  entryRole: SpawnedAgentRole;
  spawnedAgents: SpawnedAgentTemplate[];
  edges: Array<{
    sourceRole: SpawnedAgentRole;
    targetRole: SpawnedAgentRole;
    trigger: TopologyTrigger;
    messageMode: TopologyEdgeMessageMode;
    maxTriggerRounds?: number;
  }>;
  exitWhen: "one_side_agrees" | "all_completed";
}

export type SpawnRule =
  | (SpawnRuleBase & {
      reportToTemplateName: string;
      reportToTrigger: TopologyTrigger;
      reportToMessageMode?: TopologyEdgeMessageMode;
      reportToMaxTriggerRounds?: number;
    })
  | (SpawnRuleBase & {
      reportToTemplateName?: undefined;
      reportToTrigger?: undefined;
      reportToMessageMode?: undefined;
      reportToMaxTriggerRounds?: undefined;
    });

export interface TopologyNodeRecord {
  id: string;
  kind: TopologyNodeKind;
  templateName: string;
  initialMessageRouting: InitialMessageRouting;
  spawnRuleId?: string;
  spawnEnabled?: boolean;
  prompt?: string;
  writable?: boolean;
}

export interface TaskAgentRecord {
  id: string;
  taskId: string;
  opencodeSessionId: string | null;
  opencodeAttachBaseUrl: string | null;
  status: AgentStatus;
  runCount: number;
}

export type TopologyTrigger = string;
export type TopologyEdgeTrigger = TopologyTrigger;
export type TopologyEdgeMessageMode = "none" | "last";

export const DEFAULT_ACTION_REQUIRED_MAX_ROUNDS = 4;
const DEFAULT_TOPOLOGY_EDGE_MESSAGE_MODE: TopologyEdgeMessageMode =
  "last";
export const LANGGRAPH_START_NODE_ID = "__start__";
export const LANGGRAPH_END_NODE_ID = "__end__";

export interface TopologyEdge {
  source: string;
  target: string;
  trigger: TopologyTrigger;
  messageMode: TopologyEdgeMessageMode;
  maxTriggerRounds?: number;
}

type TopologyTriggerRouteKind = "labeled" | "action_required";

interface TopologyTriggerRoute {
  source: string;
  trigger: TopologyTrigger;
  routeKind: TopologyTriggerRouteKind;
}

interface TopologyTriggerRouteInput {
  edges: ReadonlyArray<
    Pick<TopologyEdge, "source" | "trigger" | "maxTriggerRounds">
  >;
  endIncoming: ReadonlyArray<TopologyLangGraphEndIncoming>;
}

export interface TopologyLangGraphStartNode {
  id: typeof LANGGRAPH_START_NODE_ID;
  targets: string[];
}

export interface TopologyLangGraphEndIncoming {
  source: string;
  trigger: TopologyTrigger;
}

export interface TopologyLangGraphEndNode {
  id: typeof LANGGRAPH_END_NODE_ID;
  sources: string[];
  incoming: TopologyLangGraphEndIncoming[];
}

export interface TopologyLangGraphRecord {
  start: TopologyLangGraphStartNode;
  end: TopologyLangGraphEndNode | null;
}

export interface TopologyRecord {
  nodes: string[];
  edges: TopologyEdge[];
  langgraph?: TopologyLangGraphRecord;
  nodeRecords: TopologyNodeRecord[];
  spawnRules?: SpawnRule[];
}

export interface RuntimeTopologyNode {
  id: string;
  kind: TopologyNodeKind;
  templateName: string;
  displayName: string;
  sourceNodeId: string;
  groupId: string | null;
  role: SpawnedAgentRole | null;
  spawnRuleId?: string;
}

interface SpawnBundleRuntimeNodeBase {
  id: string;
  templateName: string;
  displayName: string;
  sourceNodeId: string;
  groupId: string;
  role: SpawnedAgentRole;
}

export type SpawnBundleRuntimeNode =
  | (SpawnBundleRuntimeNodeBase & {
      kind: "agent";
    })
  | (SpawnBundleRuntimeNodeBase & {
      kind: "spawn";
      spawnRuleId: string;
    });

export interface RuntimeTopologyEdge {
  source: string;
  target: string;
  trigger: TopologyTrigger;
  messageMode: TopologyEdgeMessageMode;
  maxTriggerRounds?: number;
}

export interface SpawnItemPayload {
  id: string;
  title: string;
}

export interface SpawnBundleInstantiation {
  groupId: string;
  activationId: string;
  spawnNodeName: string;
  item: SpawnItemPayload;
  nodes: SpawnBundleRuntimeNode[];
  edges: RuntimeTopologyEdge[];
}

export interface SpawnActivationRecord {
  id: string;
  spawnNodeName: string;
  spawnRuleId: string;
  sourceContent: string;
  bundleGroupIds: string[];
  completedBundleGroupIds: string[];
  dispatched: boolean;
}

export function normalizeActionRequiredMaxRounds(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("maxTriggerRounds 必须是大于等于 1 的整数");
  }
  return value;
}

export function normalizeInitialMessageAgentIds(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  const rawValues = typeof value === "string" ? [value] : value;
  if (!Array.isArray(rawValues)) {
    throw new Error("initialMessage 必须是字符串或字符串数组");
  }

  const normalizedValues: string[] = [];
  for (const item of rawValues) {
    if (typeof item !== "string") {
      throw new Error("initialMessage 只允许包含 Agent ID 字符串");
    }
    const normalizedItem = item.trim();
    if (!normalizedItem) {
      throw new Error("initialMessage 不允许包含空白 Agent ID");
    }
    if (!normalizedValues.includes(normalizedItem)) {
      normalizedValues.push(normalizedItem);
    }
  }

  return normalizedValues;
}

function assertInitialMessageAgentIds(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new Error("initialMessageRouting.mode=list 时必须显式提供 agentIds 数组");
  }
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error("initialMessageRouting.agentIds 只允许包含非空 Agent ID 字符串");
    }
  }
}

export function parseInitialMessageRoutingFromDslInput(
  value: unknown,
): InitialMessageRouting {
  if (value === undefined) {
    return { mode: "inherit" };
  }

  const agentIds = normalizeInitialMessageAgentIds(value);
  if (agentIds.length === 0) {
    return { mode: "none" };
  }
  return {
    mode: "list",
    agentIds,
  };
}

function assertInitialMessageRouting(
  value: unknown,
): asserts value is InitialMessageRouting {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "mode" in value
  ) {
    const record = value as Record<string, unknown>;
    if (record["mode"] === "inherit") {
      return;
    }
    if (record["mode"] === "none") {
      return;
    }
    if (record["mode"] === "list") {
      assertInitialMessageAgentIds(record["agentIds"]);
      return;
    }
    throw new Error("非法 initialMessageRouting.mode");
  }

  throw new Error("非法 initialMessageRouting");
}

export function getActionRequiredEdgeLoopLimit(
  topology: Pick<TopologyRecord, "edges"> &
    Partial<Pick<TopologyRecord, "langgraph">>,
  sourceAgentId: string,
  targetAgentId: string,
  trigger: string,
): number {
  const candidateEdges = topology.edges.filter(
    (item) =>
      item.source === sourceAgentId &&
      item.target === targetAgentId &&
      resolveTriggerRoutingKindForSource(
        topology,
        item.source,
        item.trigger,
      ) === "action_required",
  );
  if (candidateEdges.length === 0) {
    throw new Error(
      `未找到 action_required 边：${sourceAgentId} -> ${targetAgentId}`,
    );
  }

  const edge = candidateEdges.find(
    (item) => normalizeTopologyEdgeTrigger(item.trigger) === trigger,
  );
  if (!edge) {
    throw new Error(
      `未找到匹配 trigger 的 action_required 边：${sourceAgentId} -> ${targetAgentId} (${trigger})`,
    );
  }

  return edge.maxTriggerRounds === undefined
    ? DEFAULT_ACTION_REQUIRED_MAX_ROUNDS
    : normalizeActionRequiredMaxRounds(edge.maxTriggerRounds);
}

interface BaseMessageRecord {
  id: string;
  taskId: string;
  content: string;
  sender: string;
  timestamp: string;
}

export interface UserMessageRecord extends BaseMessageRecord {
  kind: "user";
  sender: "user";
  scope: "task";
  taskTitle: string;
  targetAgentIds: string[];
  targetRunCounts: number[];
}

export interface SystemMessageRecord extends BaseMessageRecord {
  kind: "system-message";
  sender: "system";
}

export interface TaskCreatedMessageRecord extends BaseMessageRecord {
  kind: "task-created";
  sender: "system";
}

export type AgentProgressActivityKind =
  | "thinking"
  | "tool"
  | "step"
  | "message";

export interface AgentProgressMessageRecord extends BaseMessageRecord {
  kind: "agent-progress";
  activityKind: AgentProgressActivityKind;
  label: string;
  detail: string;
  detailState: "complete" | "missing" | "not_applicable";
  sessionId: string;
  runCount: number;
}

type AgentFinalMessageRecordBase = BaseMessageRecord & {
  kind: "agent-final";
  runCount: number;
  responseNote: string;
  rawResponse: string;
  status: "completed" | "error";
  senderDisplayName?: string;
};

export type AgentFinalMessageRecord =
  | (AgentFinalMessageRecordBase & {
      routingKind: "default" | "invalid";
      trigger?: never;
    })
  | (AgentFinalMessageRecordBase & {
      routingKind: "labeled";
      trigger: TopologyTrigger;
    });

export interface AgentDispatchMessageRecord extends BaseMessageRecord {
  kind: "agent-dispatch";
  targetAgentIds: string[];
  targetRunCounts: number[];
  dispatchDisplayContent: string;
  senderDisplayName?: string;
}

export interface ActionRequiredRequestMessageRecord extends BaseMessageRecord {
  kind: "action-required-request";
  followUpMessageId: string;
  targetAgentIds: string[];
  targetRunCounts: number[];
  senderDisplayName?: string;
}

export interface TaskCompletedMessageRecord extends BaseMessageRecord {
  kind: "task-completed";
  sender: "system";
  status: "failed";
}

export interface TaskRoundFinishedMessageRecord extends BaseMessageRecord {
  kind: "task-round-finished";
  sender: "system";
  finishReason: string;
}

export type MessageRecord =
  | UserMessageRecord
  | SystemMessageRecord
  | TaskCreatedMessageRecord
  | AgentProgressMessageRecord
  | AgentFinalMessageRecord
  | AgentDispatchMessageRecord
  | ActionRequiredRequestMessageRecord
  | TaskCompletedMessageRecord
  | TaskRoundFinishedMessageRecord;

export function isUserMessageRecord(
  message: MessageRecord,
): message is UserMessageRecord {
  return message.kind === "user";
}

export function isAgentFinalMessageRecord(
  message: MessageRecord,
): message is AgentFinalMessageRecord {
  return message.kind === "agent-final";
}

export function isAgentProgressMessageRecord(
  message: MessageRecord,
): message is AgentProgressMessageRecord {
  return message.kind === "agent-progress";
}

export function isAgentDispatchMessageRecord(
  message: MessageRecord,
): message is AgentDispatchMessageRecord {
  return message.kind === "agent-dispatch";
}

export function isActionRequiredRequestMessageRecord(
  message: MessageRecord,
): message is ActionRequiredRequestMessageRecord {
  return message.kind === "action-required-request";
}

export function isTaskCompletedMessageRecord(
  message: MessageRecord,
): message is TaskCompletedMessageRecord {
  return message.kind === "task-completed";
}

export function isTaskRoundFinishedMessageRecord(
  message: MessageRecord,
): message is TaskRoundFinishedMessageRecord {
  return message.kind === "task-round-finished";
}

export function getMessageTargetAgentIds(message: MessageRecord): string[] {
  switch (message.kind) {
    case "user":
    case "agent-dispatch":
    case "action-required-request":
      return message.targetAgentIds;
    default:
      return [];
  }
}

export function getMessageSenderDisplayName(
  message: MessageRecord,
): string | undefined {
  switch (message.kind) {
    case "agent-final":
    case "agent-dispatch":
    case "action-required-request":
      return message.senderDisplayName;
    default:
      return undefined;
  }
}

export interface AgentRuntimeActivity {
  id: string;
  kind: "tool" | "message" | "thinking" | "step";
  label: string;
  detail: string;
  timestamp: string;
}

export interface AgentRuntimeSnapshot {
  taskId: string;
  agentId: string;
  sessionId: string | null;
  status: AgentStatus;
  runtimeStatus: AgentStatus;
  messageCount: number;
  updatedAt: string | null;
  headline: string | null;
  activeToolNames: string[];
  activities: AgentRuntimeActivity[];
}

export interface TaskSnapshot {
  task: TaskRecord;
  agents: TaskAgentRecord[];
  messages: MessageRecord[];
  topology: TopologyRecord;
}

export interface WorkspaceSnapshot {
  cwd: string;
  name: string;
  agents: AgentRecord[];
  topology: TopologyRecord;
  messages: MessageRecord[];
  tasks: TaskSnapshot[];
}

export interface UiSnapshotPayload {
  workspace: WorkspaceSnapshot | null;
  task: TaskSnapshot | null;
  launchTaskId: string | null;
  launchCwd: string | null;
  taskLogFilePath: string | null;
  taskUrl: string | null;
}

export interface SubmitTaskPayload {
  cwd?: string;
  taskId?: string;
  newTaskId?: string;
  content: string;
  mentionAgentId?: string;
}

export interface InitializeTaskPayload {
  cwd: string;
  title?: string;
  taskId?: string;
}

export interface UpdateTopologyPayload {
  cwd: string;
  topology: TopologyRecord;
}

export interface GetTaskRuntimePayload {
  cwd: string;
  taskId: string;
}

export interface OpenAgentTerminalPayload {
  cwd: string;
  taskId: string;
  agentId: string;
}

export interface DeleteTaskPayload {
  cwd: string;
  taskId: string;
}

export interface AgentTeamEvent {
  type:
    | "workspace-updated"
    | "task-created"
    | "task-updated"
    | "message-created"
    | "agent-status-changed";
  cwd: string;
  payload: unknown;
}

export function normalizeTopologyEdgeTrigger(value: unknown): TopologyTrigger {
  if (typeof value !== "string") {
    throw new Error(`非法拓扑 trigger：${String(value)}`);
  }
  const normalized = value.trim();
  if (!/^<([^\s<>/]+)>$/u.test(normalized)) {
    throw new Error(`非法拓扑 trigger：${String(value)}`);
  }
  return normalized;
}

export function isDefaultTopologyTrigger(trigger: string): boolean {
  return trigger === DEFAULT_TOPOLOGY_TRIGGER;
}

export function isActionRequiredTopologyTrigger(
  trigger: string,
  maxTriggerRounds?: number,
): boolean {
  return (
    !isDefaultTopologyTrigger(trigger) && typeof maxTriggerRounds === "number"
  );
}

function computeTopologyTriggerRoutes(
  input: TopologyTriggerRouteInput,
): TopologyTriggerRoute[] {
  const routesBySourceAndTrigger = new Map<string, TopologyTriggerRoute>();
  const register = (
    source: string,
    trigger: string,
    routeKind: "labeled" | "action_required",
  ) => {
    if (isDefaultTopologyTrigger(trigger)) {
      return;
    }
    const normalizedTrigger = normalizeTopologyEdgeTrigger(trigger);
    const currentRouteKind = routeKind;
    const key = `${source}__${normalizedTrigger}`;
    const existingRoute = routesBySourceAndTrigger.get(key);
    if (existingRoute && existingRoute.routeKind !== currentRouteKind) {
      throw new Error(
        `同一 source 不允许把同一个 trigger 同时用于 action_required 和 labeled：${source} ${normalizedTrigger}`,
      );
    }
    routesBySourceAndTrigger.set(key, {
      source,
      trigger: normalizedTrigger,
      routeKind: currentRouteKind,
    });
  };

  const edgeGroups = new Map<
    string,
    {
      source: string;
      trigger: string;
      hasTriggerLimit: boolean;
      hasPlainRoute: boolean;
    }
  >();
  for (const edge of input.edges) {
    const normalizedTrigger = normalizeTopologyEdgeTrigger(edge.trigger);
    if (isDefaultTopologyTrigger(normalizedTrigger)) {
      continue;
    }
    const key = `${edge.source}__${normalizedTrigger}`;
    const current = edgeGroups.get(key);
    edgeGroups.set(key, {
      source: edge.source,
      trigger: normalizedTrigger,
      hasTriggerLimit:
        (current?.hasTriggerLimit ?? false) ||
        typeof edge.maxTriggerRounds === "number",
      hasPlainRoute:
        (current?.hasPlainRoute ?? false) ||
        typeof edge.maxTriggerRounds !== "number",
    });
  }
  for (const edge of edgeGroups.values()) {
    if (edge.hasTriggerLimit && edge.hasPlainRoute) {
      throw new Error(
        `同一 source 不允许把同一个 trigger 同时用于 action_required 和 labeled：${edge.source} ${edge.trigger}`,
      );
    }
    register(
      edge.source,
      edge.trigger,
      edge.hasTriggerLimit ? "action_required" : "labeled",
    );
  }
  for (const edge of input.endIncoming) {
    register(edge.source, edge.trigger, "labeled");
  }

  return [...routesBySourceAndTrigger.values()];
}

export function collectTopologyTriggerShapes(
  input: TopologyTriggerRouteInput,
): TopologyTriggerRoute[] {
  return computeTopologyTriggerRoutes(input);
}

export function assertNoAmbiguousTopologyTriggerRoutes(
  input: TopologyTriggerRouteInput,
): void {
  computeTopologyTriggerRoutes(input);
}

export function resolveTriggerRoutingKindForSource(
  topology: Pick<TopologyRecord, "edges"> &
    Partial<Pick<TopologyRecord, "langgraph">>,
  source: string,
  trigger: string,
): "labeled" | "action_required" | null {
  const normalizedTrigger = normalizeTopologyEdgeTrigger(trigger);
  if (isDefaultTopologyTrigger(normalizedTrigger)) {
    return null;
  }
  return (
    collectTopologyTriggerShapes({
      edges: topology.edges,
      endIncoming: topology.langgraph?.end?.incoming ?? [],
    }).find(
      (item) => item.source === source && item.trigger === normalizedTrigger,
    )?.routeKind ?? null
  );
}

export function getTopologyEdgeId(
  edge: Pick<TopologyEdge, "source" | "target" | "trigger">,
): string {
  return `${edge.source}__${edge.target}__${normalizeTopologyEdgeTrigger(edge.trigger)}`;
}

export function isDecisionAgentInTopology(
  topology: Pick<TopologyRecord, "edges"> &
    Partial<Pick<TopologyRecord, "langgraph">>,
  agentId: string,
): boolean {
  const hasDecisionEdge = topology.edges.some(
    (edge) =>
      edge.source === agentId &&
      !isDefaultTopologyTrigger(normalizeTopologyEdgeTrigger(edge.trigger)),
  );
  if (hasDecisionEdge) {
    return true;
  }

  const endIncoming = topology.langgraph?.end?.incoming ?? [];
  return endIncoming.some(
    (edge) =>
      edge.source === agentId &&
      !isDefaultTopologyTrigger(normalizeTopologyEdgeTrigger(edge.trigger)),
  );
}

export function resolveBuildAgentId(
  agents: ReadonlyArray<Pick<TopologyAgentSeed, "id"> | string>,
): string | null {
  for (const agent of agents) {
    const agentId = typeof agent === "string" ? agent : agent.id;
    if (usesOpenCodeBuiltinPrompt(agentId)) {
      return agentId;
    }
  }
  return null;
}

export function resolvePrimaryTopologyStartTarget(
  topology: Pick<TopologyRecord, "langgraph" | "nodes">,
): string | null {
  const explicitStartTarget = topology.langgraph?.start.targets.find(
    (target) => target.trim().length > 0,
  );
  if (explicitStartTarget) {
    return explicitStartTarget;
  }
  return topology.nodes[0] ?? null;
}

function resolveTopologyStartAgent(
  agents: Array<Pick<TopologyAgentSeed, "id">>,
): string | null {
  return resolveBuildAgentId(agents);
}

export function resolveTopologyAgentOrder(
  agents: Array<Pick<TopologyAgentSeed, "id">>,
  preferredOrderIds?: string[] | null,
): string[] {
  const availableAgentIds = agents.map((agent) => agent.id);
  const availableAgentSet = new Set(availableAgentIds);
  const order: string[] = [];
  const push = (name: string | null | undefined) => {
    if (!name || !availableAgentSet.has(name) || order.includes(name)) {
      return;
    }
    order.push(name);
  };

  for (const name of preferredOrderIds ?? []) {
    push(name);
  }

  if (order.length === availableAgentIds.length) {
    return order;
  }

  push(resolveTopologyStartAgent(agents));
  for (const agentId of availableAgentIds) {
    push(agentId);
  }

  return order;
}

export function createDefaultTopology(
  agents: TopologyAgentSeed[],
): TopologyRecord {
  const nodes = resolveTopologyAgentOrder(agents);
  const names = new Set(nodes);
  const edges: TopologyEdge[] = [];

  const startAgentId = resolveTopologyStartAgent(agents);
  const startAgent = agents.find((agent) => agent.id === startAgentId) ?? null;
  const nextAgent = agents.find((agent) => agent.id !== startAgent?.id) ?? null;

  const push = (
    source: string | undefined,
    target: string | undefined,
    trigger: TopologyEdge["trigger"],
  ) => {
    if (!source || !target) {
      return;
    }
    if (!names.has(source) || !names.has(target)) {
      return;
    }
    edges.push({
      source,
      target,
      trigger,
      messageMode: DEFAULT_TOPOLOGY_EDGE_MESSAGE_MODE,
      ...(isActionRequiredTopologyTrigger(
        trigger,
        DEFAULT_ACTION_REQUIRED_MAX_ROUNDS,
      )
        ? {
            maxTriggerRounds: DEFAULT_ACTION_REQUIRED_MAX_ROUNDS,
          }
        : {}),
    });
  };

  push(startAgent?.id, nextAgent?.id, DEFAULT_TOPOLOGY_TRIGGER);

  return {
    nodes,
    edges,
    langgraph: createTopologyLangGraphRecord({
      nodes,
      edges,
      startTargets: startAgent?.id
        ? [startAgent.id]
        : nodes[0]
          ? [nodes[0]]
          : [],
    }),
    nodeRecords: buildTopologyNodeRecords({
      nodes,
      spawnNodeIds: new Set(),
      templateNameByNodeId: new Map(),
      initialMessageRoutingByNodeId: new Map(),
      spawnRuleIdByNodeId: new Map(),
      spawnEnabledNodeIds: new Set(),
      promptByNodeId: new Map(),
      writableNodeIds: new Set(),
    }),
    spawnRules: [],
  };
}

export function buildTopologyNodeRecords(input: {
  nodes: string[];
  spawnNodeIds: ReadonlySet<string>;
  templateNameByNodeId: ReadonlyMap<string, string>;
  initialMessageRoutingByNodeId: ReadonlyMap<string, InitialMessageRouting>;
  spawnRuleIdByNodeId: ReadonlyMap<string, string>;
  spawnEnabledNodeIds: ReadonlySet<string>;
  promptByNodeId: ReadonlyMap<string, string>;
  writableNodeIds: ReadonlySet<string>;
}): TopologyNodeRecord[] {
  return input.nodes.map((nodeId) => {
    const templateName = input.templateNameByNodeId.get(nodeId) ?? nodeId;
    const initialMessageRouting =
      input.initialMessageRoutingByNodeId.get(nodeId) ?? { mode: "inherit" };
    const isSpawnNode = input.spawnNodeIds.has(nodeId);
    const spawnRuleId = input.spawnRuleIdByNodeId.get(nodeId);
    const prompt = input.promptByNodeId.get(nodeId);

    return {
      id: nodeId,
      kind: isSpawnNode ? "spawn" : "agent",
      templateName,
      initialMessageRouting,
      ...(typeof spawnRuleId === "string" ? { spawnRuleId } : {}),
      ...(input.spawnEnabledNodeIds.has(nodeId) ? { spawnEnabled: true } : {}),
      ...(typeof prompt === "string" ? { prompt } : {}),
      ...(input.writableNodeIds.has(nodeId) ? { writable: true } : {}),
    };
  });
}

export function getTopologyNodeRecords(
  topology: TopologyRecord,
): TopologyNodeRecord[] {
  if (topology.nodeRecords.length === 0) {
    throw new Error("拓扑缺少 nodeRecords。");
  }
  for (const node of topology.nodeRecords) {
    if (
      typeof node?.id !== "string" ||
      node.id.length === 0 ||
      typeof node.templateName !== "string" ||
      node.templateName.length === 0 ||
      (node.kind !== "agent" && node.kind !== "spawn")
    ) {
      throw new Error("拓扑 nodeRecords 存在非法节点记录。");
    }
    assertInitialMessageRouting(node.initialMessageRouting);
  }
  return topology.nodeRecords;
}

export function getSpawnRules(topology: TopologyRecord): SpawnRule[] {
  const spawnNodeNameByRuleId = new Map(
    getTopologyNodeRecords(topology)
      .filter((node) => node.kind === "spawn")
      .map((node) => [node.spawnRuleId!, node.id]),
  );
  return (topology.spawnRules ?? []).map((rule) => {
    if (rule.reportToTemplateName && !rule.reportToTrigger) {
      throw new Error(
        `spawn rule ${rule.id} 存在 report target 时，必须显式声明 reportToTrigger。`,
      );
    }
    const reportToTrigger =
      typeof rule.reportToTrigger === "string"
        ? normalizeTopologyEdgeTrigger(rule.reportToTrigger)
        : null;

    const normalizedBase = {
      id: rule.id,
      spawnNodeName:
        rule.spawnNodeName ?? spawnNodeNameByRuleId.get(rule.id) ?? rule.id,
      ...(rule.sourceTemplateName
        ? { sourceTemplateName: rule.sourceTemplateName }
        : {}),
      entryRole: rule.entryRole,
      spawnedAgents: rule.spawnedAgents.map((agent) => ({ ...agent })),
      edges: rule.edges.map((edge) => {
        const trigger = normalizeTopologyEdgeTrigger(edge.trigger);
        return {
          ...edge,
          trigger,
          ...(isActionRequiredTopologyTrigger(trigger, edge.maxTriggerRounds) &&
          typeof edge.maxTriggerRounds === "number"
            ? {
                maxTriggerRounds: normalizeActionRequiredMaxRounds(
                  edge.maxTriggerRounds,
                ),
              }
            : {}),
        };
      }),
      exitWhen: rule.exitWhen,
    };
    if (!reportToTrigger || !rule.reportToTemplateName) {
      return normalizedBase;
    }
    return {
      ...normalizedBase,
      reportToTemplateName: rule.reportToTemplateName,
      reportToTrigger,
      ...(rule.reportToMessageMode
        ? { reportToMessageMode: rule.reportToMessageMode }
        : {}),
      ...(isActionRequiredTopologyTrigger(
        reportToTrigger,
        rule.reportToMaxTriggerRounds,
      ) && typeof rule.reportToMaxTriggerRounds === "number"
        ? {
            reportToMaxTriggerRounds: normalizeActionRequiredMaxRounds(
              rule.reportToMaxTriggerRounds,
            ),
          }
        : {}),
    };
  });
}

export function createTopologyLangGraphRecord(input: {
  nodes: string[];
  edges: TopologyEdge[];
  startTargets?: ReadonlyArray<string>;
  endSources?: ReadonlyArray<string>;
  endIncoming?: ReadonlyArray<TopologyLangGraphEndIncoming>;
}): TopologyLangGraphRecord {
  const knownNodes = new Set(input.nodes);
  const normalizeRefs = (values: ReadonlyArray<string> | undefined) =>
    (values ?? [])
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      .map((value) => value.trim())
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => knownNodes.has(value));

  let startTargets = normalizeRefs(input.startTargets);
  if (startTargets.length === 0) {
    const incomingTargets = new Set(input.edges.map((edge) => edge.target));
    startTargets = input.nodes.filter((node) => !incomingTargets.has(node));
  }
  if (startTargets.length === 0 && input.nodes.length > 0) {
    startTargets = [input.nodes[0]!];
  }

  const endIncoming = (input.endIncoming ?? [])
    .map((value) => {
      return {
        source: value.source.trim(),
        trigger: normalizeTopologyEdgeTrigger(value.trigger),
      };
    })
    .filter((value) => value.source.length > 0)
    .filter((value) => knownNodes.has(value.source))
    .filter(
      (value, index, list) =>
        list.findIndex(
          (item) =>
            item.source === value.source && item.trigger === value.trigger,
        ) === index,
    );
  const endSources = normalizeRefs([
    ...(input.endSources ?? []),
    ...endIncoming.map((item) => item.source),
  ]);

  return {
    start: {
      id: LANGGRAPH_START_NODE_ID,
      targets: startTargets,
    },
    end:
      endSources.length > 0
        ? {
            id: LANGGRAPH_END_NODE_ID,
            sources: endSources,
            incoming: endIncoming,
          }
        : null,
  };
}
