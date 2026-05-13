import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import {
  applyAgentResultToGraphState,
  createUserDispatchDecision,
  type GraphRoutingDecision,
} from "./gating-router";
import { createEmptyGraphTaskState, type GraphTaskState } from "./gating-state";
import type {
  LangGraphBatchRunner,
  LangGraphInputEvent,
  LangGraphTaskLoopHost,
} from "./langgraph-host";

interface RuntimeEnvelope {
  graphState: GraphStateSlot;
  pendingInput: PendingInputSlot;
  lastDecision: LastDecisionSlot;
  lastError: LastRuntimeError;
}

type GraphStateSlot =
  | {
      kind: "created";
      graphState: GraphTaskState;
    }
  | {
      kind: "empty";
    };

type PendingInputSlot =
  | {
      kind: "received";
      event: LangGraphInputEvent;
    }
  | {
      kind: "empty";
    };

type LastDecisionSlot =
  | {
      kind: "decided";
      decision: GraphRoutingDecision;
    }
  | {
      kind: "empty";
    };

type LastRuntimeError =
  | {
      kind: "failed";
      message: string;
    }
  | {
      kind: "none";
    };

type CheckpointSlot =
  | {
      kind: "found";
      checkpoint: RuntimeEnvelope;
    }
  | {
      kind: "missing";
    };

function takeLatestValue<T>(...values: [previous: T, next: T]): T {
  return values[1];
}

const RuntimeAnnotation = Annotation.Root({
  graphState: Annotation<GraphStateSlot>({
    reducer: takeLatestValue,
    default: () => ({ kind: "empty" }),
  }),
  pendingInput: Annotation<PendingInputSlot>({
    reducer: takeLatestValue,
    default: () => ({ kind: "empty" }),
  }),
  lastDecision: Annotation<LastDecisionSlot>({
    reducer: takeLatestValue,
    default: () => ({ kind: "empty" }),
  }),
  lastError: Annotation<LastRuntimeError>({
    reducer: takeLatestValue,
    default: () => ({ kind: "none" }),
  }),
});

function runtimeConfig(taskId: string) {
  return {
    configurable: {
      thread_id: taskId,
    },
  };
}

export class LangGraphRuntime {
  private readonly checkpointer: MemorySaver;
  private readonly graph;

  constructor(
    private readonly options: {
      host: LangGraphTaskLoopHost;
    },
  ) {
    this.checkpointer = new MemorySaver();

    const builder = new StateGraph(RuntimeAnnotation)
      .addNode("task_loop", async (state: RuntimeEnvelope) => this.runTaskLoop(state))
      .addNode("task_finished", async (state: RuntimeEnvelope) => state)
      .addNode("task_failed", async (state: RuntimeEnvelope) => state)
      .addEdge(START, "task_loop")
      .addConditionalEdges("task_loop", (state: RuntimeEnvelope) => {
        if (state.lastDecision.kind === "decided" && state.lastDecision.decision.type === "failed") {
          return "task_failed";
        }
        return "task_finished";
      })
      .addEdge("task_finished", END)
      .addEdge("task_failed", END);

    this.graph = builder.compile({
      checkpointer: this.checkpointer,
      name: "agent-team-task-runtime",
    });
  }

  async startTask(input: {
    taskId: string;
    topology: GraphTaskState["topology"];
    initialInput: LangGraphInputEvent;
  }): Promise<GraphTaskState> {
    const graphState = createEmptyGraphTaskState({
      taskId: input.taskId,
      topology: input.topology,
    });
    const result = await this.graph.invoke(
      {
        graphState: { kind: "created", graphState },
        pendingInput: { kind: "received", event: input.initialInput },
        lastDecision: { kind: "empty" },
        lastError: { kind: "none" },
      } satisfies RuntimeEnvelope,
      runtimeConfig(input.taskId),
    ) as RuntimeEnvelope;
    return result.graphState.kind === "created" ? result.graphState.graphState : graphState;
  }

  async resumeTask(input: {
    taskId: string;
    topology: GraphTaskState["topology"];
    event: LangGraphInputEvent;
  }): Promise<GraphTaskState> {
    const existing = await this.getCheckpoint(input.taskId);
    const graphState = resolveCheckpointGraphState(existing, input.taskId, input.topology);
    const result = await this.graph.invoke(
      {
        graphState: { kind: "created", graphState },
        pendingInput: { kind: "received", event: input.event },
        lastDecision: { kind: "empty" },
        lastError: { kind: "none" },
      } satisfies RuntimeEnvelope,
      runtimeConfig(input.taskId),
    ) as RuntimeEnvelope;
    return result.graphState.kind === "created" ? result.graphState.graphState : graphState;
  }

  async getCheckpoint(taskId: string): Promise<CheckpointSlot> {
    const state = await this.graph.getState(runtimeConfig(taskId));
    if (!state.values || Object.keys(state.values).length === 0) {
      return { kind: "missing" };
    }
    return { kind: "found", checkpoint: state.values as RuntimeEnvelope };
  }

  async streamTask(
    taskId: string,
    listener: (state: CheckpointSlot) => void,
  ): Promise<void> {
    listener(await this.getCheckpoint(taskId));
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.checkpointer.deleteThread(taskId);
  }

  private async runTaskLoop(state: RuntimeEnvelope): Promise<RuntimeEnvelope> {
    if (state.graphState.kind === "empty") {
      return {
        ...state,
        lastDecision: {
          kind: "decided",
          decision: {
            type: "failed",
            errorMessage: "graphState 缺失",
          },
        },
        lastError: { kind: "failed", message: "graphState 缺失" },
      };
    }

    let currentState = state.graphState.graphState;
    let currentDecision = resolveInitialRuntimeDecision(state, currentState);

    const inflight = new Map<string, LangGraphBatchRunner>();
    while (true) {
      while (currentDecision.kind === "decided" && currentDecision.decision.type === "execute_batch") {
        const runners = await this.options.host.createBatchRunners({
          taskId: currentState.taskId,
          state: currentState,
          batch: currentDecision.decision.batch,
        });
        for (const runner of runners) {
          inflight.set(runner.id, runner);
        }
        currentDecision = { kind: "empty" };
      }

      if (inflight.size === 0) {
        if (currentDecision.kind === "empty" || currentDecision.decision.type === "finished") {
          currentState.taskStatus = "finished";
          currentState.finishReason = resolveFinishReason(currentDecision, currentState);
          await this.options.host.completeTask({
            taskId: currentState.taskId,
            status: "finished",
            finishReason: currentState.finishReason,
          });
          return {
            graphState: { kind: "created", graphState: currentState },
            pendingInput: { kind: "empty" },
            lastDecision: currentDecision.kind === "decided"
              ? currentDecision
              : {
                  kind: "decided",
                  decision: {
                    type: "finished",
                    finishReason: currentState.finishReason,
                  },
                },
            lastError: { kind: "none" },
          };
        }

        const failedDecision = requireFailedDecision(currentDecision);
        currentState.taskStatus = "failed";
        currentState.finishReason = "running";
        await this.options.host.completeTask({
          taskId: currentState.taskId,
          status: "failed",
          failureReason: failedDecision.errorMessage,
        });
        return {
          graphState: { kind: "created", graphState: currentState },
          pendingInput: { kind: "empty" },
          lastDecision: currentDecision,
          lastError: { kind: "failed", message: failedDecision.errorMessage },
        };
      }

      const settled = await Promise.race(
        [...inflight.values()].map(async (runner) => ({
          id: runner.id,
          result: await runner.promise,
        })),
      );
      inflight.delete(settled.id);
      const reduced = applyAgentResultToGraphState(currentState, settled.result);
      currentState = reduced.state;
      currentDecision = { kind: "decided", decision: reduced.decision };
    }
  }
}

function resolveCheckpointGraphState(
  checkpoint: CheckpointSlot,
  taskId: string,
  topology: GraphTaskState["topology"],
): GraphTaskState {
  if (checkpoint.kind === "found" && checkpoint.checkpoint.graphState.kind === "created") {
    return checkpoint.checkpoint.graphState.graphState;
  }
  return createEmptyGraphTaskState({
    taskId,
    topology,
  });
}

function resolveInitialRuntimeDecision(
  state: RuntimeEnvelope,
  currentState: GraphTaskState,
): LastDecisionSlot {
  if (state.pendingInput.kind === "received") {
    return {
      kind: "decided",
      decision: createUserDispatchDecision(currentState, {
        targetAgentId: state.pendingInput.event.targetAgentId,
        content: state.pendingInput.event.content,
      }),
    };
  }
  return state.lastDecision;
}

function resolveFinishReason(
  decision: LastDecisionSlot,
  currentState: GraphTaskState,
): string {
  if (decision.kind === "decided" && decision.decision.type === "finished") {
    return decision.decision.finishReason;
  }
  if (currentState.finishReason) {
    return currentState.finishReason;
  }
  return "idle";
}

function requireFailedDecision(
  decision: LastDecisionSlot,
): Extract<GraphRoutingDecision, { type: "failed" }> {
  if (decision.kind === "decided" && decision.decision.type === "failed") {
    return decision.decision;
  }
  throw new Error("期望 failed decision");
}
