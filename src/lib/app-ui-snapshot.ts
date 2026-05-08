import type {
  TaskSnapshot,
  UiSnapshotPayload,
  WorkspaceSnapshot,
} from "@shared/types";

import {
  decideUiSnapshotRefreshAcceptance,
  type LatestAcceptedUiSnapshotState,
} from "./ui-snapshot-refresh-gate";

type AppTaskView =
  | {
      kind: "empty";
    }
  | {
      kind: "ready";
      workspace: WorkspaceSnapshot;
      task: TaskSnapshot;
    };

export interface AppUiSnapshot {
  taskView: AppTaskView;
  taskLogFilePath: string;
  taskUrl: string;
}

export function createInitialAppUiSnapshot(): AppUiSnapshot {
  return {
    taskView: EMPTY_TASK_VIEW,
    taskLogFilePath: "",
    taskUrl: "",
  };
}

const EMPTY_TASK_VIEW: AppTaskView = {
  kind: "empty",
};

function buildTaskView(payload: UiSnapshotPayload): AppTaskView {
  if (!payload.workspace || !payload.task) {
    return EMPTY_TASK_VIEW;
  }

  return {
    kind: "ready",
    workspace: payload.workspace,
    task: payload.task,
  };
}

function projectAppUiSnapshot(payload: UiSnapshotPayload): AppUiSnapshot {
  return {
    taskView: buildTaskView(payload),
    taskLogFilePath: payload.taskLogFilePath ?? "",
    taskUrl: payload.taskUrl ?? "",
  };
}

export function decideAppUiSnapshotRefresh(input: {
  latestAcceptedRequestId: number;
  latestAcceptedState: LatestAcceptedUiSnapshotState;
  requestId: number;
  payload: UiSnapshotPayload;
}):
  | {
      accepted: false;
      latestAcceptedRequestId: number;
      latestAcceptedState: LatestAcceptedUiSnapshotState;
    }
  | {
      accepted: true;
      latestAcceptedRequestId: number;
      latestAcceptedState: LatestAcceptedUiSnapshotState;
      appSnapshot: AppUiSnapshot;
    } {
  const acceptance = decideUiSnapshotRefreshAcceptance({
    latestAcceptedRequestId: input.latestAcceptedRequestId,
    latestAcceptedState: input.latestAcceptedState,
    requestId: input.requestId,
    payload: input.payload,
  });

  if (!acceptance.accepted) {
    return {
      accepted: false,
      latestAcceptedRequestId: acceptance.latestAcceptedRequestId,
      latestAcceptedState: acceptance.latestAcceptedState,
    };
  }

  return {
    accepted: true,
    latestAcceptedRequestId: acceptance.latestAcceptedRequestId,
    latestAcceptedState: acceptance.latestAcceptedState,
    appSnapshot: projectAppUiSnapshot(acceptance.latestAcceptedState.payload),
  };
}
