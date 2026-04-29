import {
  DEFAULT_TOPOLOGY_TRIGGER,
  getTopologyEdgeId,
  resolveTriggerRoutingKindForSource,
  type TopologyEdge,
  type TopologyRecord,
} from "@shared/types";

import type {
  GatingHandoffDispatchBatchState,
  GatingSchedulerRuntimeState,
  GatingSourceRoundState,
} from "./gating-state";

export interface GatingAgentState {
  id: string;
  status: "idle" | "running" | "completed" | "failed" | "action_required";
}

export interface GatingDispatchPlan {
  sourceAgentId: string;
  sourceContent: string;
  displayTargets: string[];
  triggerTargets: string[];
  readyTargets: string[];
  queuedTargets: string[];
}

interface GatingBatchContinuationBase {
  sourceAgentId: string;
  sourceContent: string;
}

export type GatingBatchContinuation =
  | (GatingBatchContinuationBase & {
      kind: "pending_targets";
      pendingTargets: string[];
      redispatchTargets: [];
    })
  | (GatingBatchContinuationBase & {
      kind: "redispatch";
      pendingTargets: [];
      redispatchTargets: string[];
    })
  | (GatingBatchContinuationBase & {
      kind: "settled";
      pendingTargets: [];
      redispatchTargets: [];
    });

export type GatingRepairBatchContinuation = GatingBatchContinuationBase & {
  kind: "repair";
  pendingTargets: [];
  redispatchTargets: [];
  repairDecisionAgentId: string;
};

export function createGatingSchedulerRuntimeState(): GatingSchedulerRuntimeState {
  return {
    completedEdges: new Set(),
    edgeTriggerVersion: new Map(),
    lastSignatureByAgent: new Map(),
    runningAgents: new Set(),
    queuedAgents: new Set(),
    sourceRoundStateByAgent: new Map(),
    activeHandoffBatchBySource: new Map(),
  };
}

export class GatingScheduler {
  constructor(
    private readonly topology: TopologyRecord,
    private readonly runtime: GatingSchedulerRuntimeState,
  ) {}

  invalidateDownstreamTriggerSignatures(agentId: string) {
    const downstreamTargets = this.topology.edges
      .filter((edge) => edge.source === agentId)
      .map((edge) => edge.target);

    for (const targetName of downstreamTargets) {
      this.runtime.lastSignatureByAgent.delete(targetName);
    }
  }

  markAgentRunning(agentId: string) {
    this.runtime.runningAgents.add(agentId);
  }

  markAgentSettled(agentId: string) {
    this.runtime.runningAgents.delete(agentId);
    this.runtime.queuedAgents.delete(agentId);
  }

  planHandoffDispatch(
    sourceAgentId: string,
    sourceContent: string,
    agentStates: GatingAgentState[],
    options: {
      excludeTargets?: Set<string>;
      restrictTargets?: Set<string>;
      advanceSourceRound?: boolean;
    } = {},
  ): GatingDispatchPlan | null {
    const outgoing = this.getOutgoingEdges(sourceAgentId, DEFAULT_TOPOLOGY_TRIGGER);
    const excludeTargets = options.excludeTargets ?? new Set<string>();
    const restrictTargets = options.restrictTargets;
    const advanceSourceRound = options.advanceSourceRound ?? true;

    const selectedOutgoing = outgoing.filter(
      (edge) =>
        !excludeTargets.has(edge.target)
        && (!restrictTargets || restrictTargets.has(edge.target)),
    );
    if (selectedOutgoing.length === 0) {
      return null;
    }

    const completed = new Set(this.runtime.completedEdges);
    for (const edge of selectedOutgoing) {
      const edgeId = getTopologyEdgeId(edge);
      completed.add(edgeId);
      this.runtime.completedEdges.add(edgeId);
      this.runtime.edgeTriggerVersion.set(edgeId, (this.runtime.edgeTriggerVersion.get(edgeId) ?? 0) + 1);
    }

    const targetNames = this.uniqueTargetNames(selectedOutgoing);
    const sourceState = this.getOrCreateSourceRoundState(sourceAgentId);
    if (advanceSourceRound) {
      sourceState.currentRound += 1;
    }

    const batch: GatingHandoffDispatchBatchState = {
      dispatchKind: "handoff",
      sourceAgentId,
      sourceContent,
      targets: targetNames,
      pendingTargets: [],
      respondedTargets: [],
      sourceRound: sourceState.currentRound,
      failedTargets: [],
    };

    const dispatchTargets = this.claimBatchTargets(batch, completed, agentStates);
    if (dispatchTargets.readyTargets.length === 0 && dispatchTargets.queuedTargets.length === 0) {
      return null;
    }

    this.runtime.activeHandoffBatchBySource.set(sourceAgentId, batch);

    return {
      sourceAgentId,
      sourceContent,
      displayTargets: targetNames,
      triggerTargets: [...targetNames],
      readyTargets: dispatchTargets.readyTargets,
      queuedTargets: dispatchTargets.queuedTargets,
    };
  }

  planLabeledDispatch(
    sourceAgentId: string,
    sourceContent: string,
    agentStates: GatingAgentState[],
    options: {
      restrictTargets?: Set<string>;
      trigger: string;
    },
  ): GatingDispatchPlan | null {
    const restrictTargets = options.restrictTargets;
    const labeledTrigger = options.trigger;
    const outgoing = this.getOutgoingEdges(sourceAgentId, labeledTrigger).filter(
      (edge) => !restrictTargets || restrictTargets.has(edge.target),
    );
    const completed = new Set(this.runtime.completedEdges);

    for (const edge of outgoing) {
      const edgeId = getTopologyEdgeId(edge);
      completed.add(edgeId);
      this.runtime.completedEdges.add(edgeId);
      this.runtime.edgeTriggerVersion.set(edgeId, (this.runtime.edgeTriggerVersion.get(edgeId) ?? 0) + 1);
    }

    const readyTargets: string[] = [];
    for (const edge of outgoing) {
      if (this.canScheduleTarget(completed, edge.target, agentStates, labeledTrigger)) {
        readyTargets.push(edge.target);
        this.runtime.lastSignatureByAgent.set(
          edge.target,
          this.buildTriggerSignature(completed, edge.target),
        );
      }
    }

    if (readyTargets.length > 0) {
      const sourceState = this.getOrCreateSourceRoundState(sourceAgentId);
      const batch: GatingHandoffDispatchBatchState = {
        dispatchKind: "labeled",
        sourceAgentId,
        sourceContent,
        targets: [...readyTargets],
        pendingTargets: [...readyTargets],
        respondedTargets: [],
        sourceRound: sourceState.currentRound,
        failedTargets: [],
      };
      this.runtime.activeHandoffBatchBySource.set(sourceAgentId, batch);
    }

    return readyTargets.length > 0
      ? {
          sourceAgentId,
          sourceContent,
          displayTargets: [...readyTargets],
          triggerTargets: [...readyTargets],
          readyTargets: [...readyTargets],
          queuedTargets: [],
        }
      : null;
  }

  recordHandoffBatchResponse(
    responderAgentId: string,
    outcome: "resolved" | "action_required",
  ): GatingBatchContinuation | GatingRepairBatchContinuation | null {
    for (const [sourceAgentId, batch] of this.runtime.activeHandoffBatchBySource.entries()) {
      if (!batch.pendingTargets.includes(responderAgentId)) {
        continue;
      }

      const sourceState = this.getOrCreateSourceRoundState(sourceAgentId);
      if (outcome === "resolved") {
        sourceState.decisionPassRound.set(responderAgentId, batch.sourceRound);
      } else if (!batch.failedTargets.includes(responderAgentId)) {
        batch.failedTargets.push(responderAgentId);
      }
      batch.pendingTargets = batch.pendingTargets.filter((targetName) => targetName !== responderAgentId);
      if (!batch.respondedTargets.includes(responderAgentId)) {
        batch.respondedTargets.push(responderAgentId);
      }

      if (batch.pendingTargets.length > 0) {
        return {
          sourceAgentId,
          sourceContent: batch.sourceContent,
          kind: "pending_targets",
          pendingTargets: [...batch.pendingTargets],
          redispatchTargets: [],
        };
      }

      this.runtime.activeHandoffBatchBySource.delete(sourceAgentId);
      if (batch.failedTargets.length > 0) {
        const repairDecisionAgentId = batch.targets.find((targetName) => batch.failedTargets.includes(targetName));
        if (!repairDecisionAgentId) {
          throw new Error(`${sourceAgentId} 缺少待修复的 decision agent`);
        }
        return {
          sourceAgentId,
          sourceContent: batch.sourceContent,
          kind: "repair",
          pendingTargets: [],
          repairDecisionAgentId,
          redispatchTargets: [],
        };
      }

      if (batch.dispatchKind === "handoff" && batch.targets.length === 1) {
        const staleTargets = this.getHandoffTargetsForBatch(sourceAgentId, batch).filter(
          (targetName) => sourceState.decisionPassRound.get(targetName) !== batch.sourceRound,
        );
        if (staleTargets.length === 0) {
          return {
            sourceAgentId,
            sourceContent: batch.sourceContent,
            kind: "settled",
            pendingTargets: [],
            redispatchTargets: [],
          };
        }
        return {
          sourceAgentId,
          sourceContent: batch.sourceContent,
          kind: "redispatch",
          pendingTargets: [],
          redispatchTargets: staleTargets,
        };
      }

      return {
        sourceAgentId,
        sourceContent: batch.sourceContent,
        kind: "settled",
        pendingTargets: [],
        redispatchTargets: [],
      };
    }

    return null;
  }

  hasSatisfiedIncomingHandoff(agentId: string): boolean {
    const incomingEdges = this.topology.edges.filter((edge) => edge.target === agentId);
    return incomingEdges.every((edge) => this.runtime.completedEdges.has(getTopologyEdgeId(edge)));
  }

  hasSatisfiedOutgoingHandoff(agentId: string): boolean {
    const outgoingEdges = this.topology.edges.filter((edge) => edge.source === agentId);
    return outgoingEdges.every((edge) => this.runtime.completedEdges.has(getTopologyEdgeId(edge)));
  }

  private claimBatchTargets(
    batch: GatingHandoffDispatchBatchState,
    completedEdges: Set<string>,
    agentStates: GatingAgentState[],
  ): {
    readyTargets: string[];
    queuedTargets: string[];
  } {
    const readyTargets: string[] = [];
    const queuedTargets: string[] = [];

    for (const targetName of batch.targets) {
      if (!this.canScheduleTarget(completedEdges, targetName, agentStates, DEFAULT_TOPOLOGY_TRIGGER)) {
        continue;
      }

      this.runtime.lastSignatureByAgent.set(
        targetName,
        this.buildTriggerSignature(completedEdges, targetName),
      );
      if (!batch.pendingTargets.includes(targetName)) {
        batch.pendingTargets.push(targetName);
      }

      if (this.runtime.runningAgents.has(targetName)) {
        queuedTargets.push(targetName);
      } else {
        readyTargets.push(targetName);
      }
    }

    return {
      readyTargets,
      queuedTargets,
    };
  }

  private getOrCreateSourceRoundState(sourceAgentId: string): GatingSourceRoundState {
    let state = this.runtime.sourceRoundStateByAgent.get(sourceAgentId);
    if (!state) {
      state = {
        currentRound: 0,
        decisionPassRound: new Map(),
      };
      this.runtime.sourceRoundStateByAgent.set(sourceAgentId, state);
    }
    return state;
  }

  private getHandoffTargets(sourceAgentId: string): string[] {
    return this.uniqueTargetNames(this.getOutgoingEdges(sourceAgentId, DEFAULT_TOPOLOGY_TRIGGER));
  }

  private getHandoffTargetsForBatch(
    sourceAgentId: string,
    batch: GatingHandoffDispatchBatchState,
  ): string[] {
    const outgoingTargets = this.getHandoffTargets(sourceAgentId);
    if (outgoingTargets.length === 0) {
      return [];
    }

    const spawnNodeIds = new Set(
      (this.topology.nodeRecords ?? [])
        .filter((node) => node.kind === "spawn")
        .map((node) => node.id),
    );
    const hasSpawnTarget = outgoingTargets.some((targetName) => spawnNodeIds.has(targetName));
    if (!hasSpawnTarget) {
      return [...batch.targets];
    }

    return this.uniqueTargetNames(
      outgoingTargets.flatMap((targetName) => (
        spawnNodeIds.has(targetName) ? batch.targets : [targetName]
      )).map((target) => ({ target })),
    );
  }

  private canScheduleTarget(
    completedEdges: Set<string>,
    targetName: string,
    agentStates: GatingAgentState[],
    triggerKind: string,
  ): boolean {
    const agent = agentStates.find((item) => item.id === targetName);
    if (!agent) {
      return false;
    }

    const incomingHandoffEdges = this.getIncomingEdges(targetName, DEFAULT_TOPOLOGY_TRIGGER);
    if (incomingHandoffEdges.some((edge) => !this.isIncomingEdgeSatisfied(edge, completedEdges))) {
      return false;
    }

    const allIncomingLabeledEdges = this.topology.edges.filter((edge) =>
      edge.target === targetName
      && resolveTriggerRoutingKindForSource(this.topology, edge.source, edge.trigger) === "labeled"
    );
    const incomingLabeledEdges = triggerKind === DEFAULT_TOPOLOGY_TRIGGER
      ? []
      : this.topology.edges.filter((edge) =>
          edge.target === targetName
          && edge.trigger === triggerKind
        );
    if (
      triggerKind === DEFAULT_TOPOLOGY_TRIGGER
      && allIncomingLabeledEdges.some((edge) =>
        this.hasSettledAgentState(edge.source, agentStates)
        && !this.isIncomingEdgeSatisfied(edge, completedEdges)
      )
    ) {
      return false;
    }
    if (
      triggerKind !== DEFAULT_TOPOLOGY_TRIGGER
      && incomingLabeledEdges.length > 0
      && !this.hasSatisfiedLabeledEdgesForTarget(targetName, incomingLabeledEdges, completedEdges, agentStates)
    ) {
      return false;
    }

    const signature = this.buildTriggerSignature(completedEdges, targetName);
    if (
      this.runtime.lastSignatureByAgent.get(targetName) === signature &&
      agent.status !== "failed" &&
      agent.status !== "action_required"
    ) {
      return false;
    }

    return true;
  }

  private hasSatisfiedLabeledEdgesForTarget(
    targetName: string,
    incomingLabeledEdges: TopologyEdge[],
    completedEdges: Set<string>,
    agentStates: GatingAgentState[],
  ): boolean {
    if (incomingLabeledEdges.length === 0) {
      return true;
    }

    if (this.requiresAllLabeledIncomingEdges(targetName, incomingLabeledEdges)) {
      return incomingLabeledEdges.some((edge) => this.isIncomingEdgeSatisfied(edge, completedEdges))
        && incomingLabeledEdges.every((edge) => this.hasSettledAgentState(edge.source, agentStates));
    }

    return incomingLabeledEdges.some((edge) => this.isIncomingEdgeSatisfied(edge, completedEdges));
  }

  private requiresAllLabeledIncomingEdges(
    targetName: string,
    incomingLabeledEdges: TopologyEdge[],
  ): boolean {
    if (incomingLabeledEdges.length <= 1) {
      return false;
    }

    const targetTemplateName = this.getTemplateName(targetName);
    if (!targetTemplateName) {
      return false;
    }
    const actualSourceTemplateNames = this.uniqueValues(
      incomingLabeledEdges.map((edge) => this.getTemplateName(edge.source)).filter((value): value is string => Boolean(value)),
    );
    if (actualSourceTemplateNames.length !== incomingLabeledEdges.length) {
      return false;
    }

    return (this.topology.spawnRules ?? []).some((rule) => {
      if (rule.exitWhen !== "all_completed") {
        return false;
      }

      const targetRoles = rule.spawnedAgents
        .filter((agent) => agent.templateName === targetTemplateName)
        .map((agent) => agent.role);
      if (targetRoles.length === 0) {
        return false;
      }

      return targetRoles.some((targetRole) => {
        const requiredEdges = rule.edges.filter(
          (edge) => edge.trigger === incomingLabeledEdges[0]?.trigger && edge.targetRole === targetRole,
        );
        if (requiredEdges.length <= 1) {
          return false;
        }

        const requiredSourceTemplateNames = this.uniqueValues(
          requiredEdges.map((edge) => this.getSpawnedTemplateName(rule, edge.sourceRole)).filter((value): value is string => Boolean(value)),
        );
        return requiredSourceTemplateNames.length === actualSourceTemplateNames.length
          && requiredSourceTemplateNames.every((templateName) => actualSourceTemplateNames.includes(templateName));
      });
    });
  }

  private getTemplateName(nodeId: string): string | null {
    const nodeRecord = this.topology.nodeRecords?.find((node) => node.id === nodeId);
    return nodeRecord?.templateName ?? nodeId;
  }

  private getSpawnedTemplateName(
    rule: NonNullable<TopologyRecord["spawnRules"]>[number],
    role: string,
  ): string | null {
    return rule.spawnedAgents.find((agent) => agent.role === role)?.templateName ?? null;
  }

  private uniqueValues(values: string[]): string[] {
    return [...new Set(values)];
  }

  private hasSettledAgentState(agentId: string, agentStates: GatingAgentState[]): boolean {
    const agentState = agentStates.find((agent) => agent.id === agentId);
    if (!agentState) {
      return false;
    }
    return agentState.status !== "idle" && agentState.status !== "running";
  }

  private isIncomingEdgeSatisfied(edge: TopologyEdge, completedEdges: Set<string>): boolean {
    if (completedEdges.has(getTopologyEdgeId(edge))) {
      return true;
    }

    return this.isSpawnReportEdgeSatisfiedByRuntimeReport(edge, completedEdges);
  }

  private isSpawnReportEdgeSatisfiedByRuntimeReport(edge: TopologyEdge, completedEdges: Set<string>): boolean {
    const spawnRule = (this.topology.spawnRules ?? []).find((rule) => {
      const spawnNodeName = rule.spawnNodeName
        || this.topology.nodeRecords?.find((node) => node.spawnRuleId === rule.id)?.id
        || "";
      return (
        spawnNodeName === edge.source
        && rule.reportToTemplateName === edge.target
        && rule.reportToTrigger === edge.trigger
      );
    });
    if (!spawnRule) {
      return false;
    }

    const terminalRoles = spawnRule.spawnedAgents
      .map((agent) => agent.role)
      .filter((role) => !spawnRule.edges.some((candidate) => candidate.sourceRole === role));
    const terminalTemplateNames = new Set(
      spawnRule.spawnedAgents
        .filter((agent) => terminalRoles.includes(agent.role))
        .map((agent) => agent.templateName),
    );
    if (terminalTemplateNames.size === 0) {
      return false;
    }

    return this.topology.edges.some((candidate) => {
      if (
        candidate.source === edge.source
        || candidate.target !== edge.target
        || candidate.trigger !== edge.trigger
        || !completedEdges.has(getTopologyEdgeId(candidate))
      ) {
        return false;
      }

      const sourceNode = this.topology.nodeRecords?.find((node) => node.id === candidate.source);
      return sourceNode ? terminalTemplateNames.has(sourceNode.templateName) : false;
    });
  }

  private buildTriggerSignature(completedEdges: Set<string>, targetName: string): string {
    const relevantEdgeIds = this.topology.edges
      .filter(
        (edge) =>
          edge.target === targetName &&
          completedEdges.has(getTopologyEdgeId(edge)),
      )
      .map((edge) => {
        const edgeId = getTopologyEdgeId(edge);
        return `${edgeId}@${this.runtime.edgeTriggerVersion.get(edgeId) ?? 0}`;
      })
      .sort();
    return relevantEdgeIds.join("|") || `direct:${targetName}`;
  }

  private getOutgoingEdges(sourceAgentId: string, trigger: TopologyEdge["trigger"]): TopologyEdge[] {
    return this.topology.edges.filter((edge) => edge.source === sourceAgentId && edge.trigger === trigger);
  }

  private getIncomingEdges(targetAgentId: string, trigger: TopologyEdge["trigger"]): TopologyEdge[] {
    return this.topology.edges.filter((edge) => edge.target === targetAgentId && edge.trigger === trigger);
  }

  private uniqueTargetNames(edges: Array<Pick<TopologyEdge, "target">>): string[] {
    const targets: string[] = [];
    for (const edge of edges) {
      if (!targets.includes(edge.target)) {
        targets.push(edge.target);
      }
    }
    return targets;
  }
}
