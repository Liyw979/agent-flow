import type {
  UiSnapshotPayload,
  TaskSnapshot,
  WorkspaceSnapshot,
} from "@shared/types";

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

export function resolveAppUiSnapshot(payload: UiSnapshotPayload): AppUiSnapshot {
  return {
    taskView: buildTaskView(payload),
    taskLogFilePath: payload.taskLogFilePath ?? "",
    taskUrl: payload.taskUrl ?? "",
  };
}
