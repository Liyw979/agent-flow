import { useEffect, useMemo, useState } from "react";
import { AgentConfigModal } from "./components/AgentConfigModal";
import { ChatWindow } from "./components/ChatWindow";
import { SidebarList } from "./components/SidebarList";
import { TopologyGraph } from "./components/TopologyGraph";
import { useAgentFlowStore } from "./store/useAgentFlowStore";
import { isBuiltinAgentPath } from "@shared/types";
import type { AgentRuntimeSnapshot, MessageRecord, TaskSnapshot } from "@shared/types";

interface OptimisticSubmission {
  id: string;
  taskId: string;
  mentionAgent?: string;
  message: MessageRecord;
}

function getAgentDisplayName(name: string) {
  if (name === "build") {
    return "Build";
  }
  return name.replace(/-Agent$/i, "");
}

function compareAgentDisplayOrder(left: { name: string }, right: { name: string }) {
  if (left.name === "build" && right.name !== "build") {
    return -1;
  }
  if (left.name !== "build" && right.name === "build") {
    return 1;
  }
  return left.name.localeCompare(right.name);
}

function getAgentStatusClassName(status: string) {
  switch (status) {
    case "running":
      return "bg-secondary text-secondary-foreground";
    case "success":
      return "bg-accent text-foreground";
    case "needs_revision":
      return "bg-[#f2d19b] text-[#6a4318]";
    case "failed":
      return "bg-primary text-primary-foreground";
    default:
      return "bg-muted text-foreground/80";
  }
}

function getAgentMetricLabel(messageCount: number) {
  return `消息 · ${messageCount}`;
}

function getAgentKindMeta(isBuiltin: boolean) {
  return isBuiltin
    ? {
        label: "Built-in",
        badgeClassName: "border border-sky-200/90 bg-sky-100/90 text-sky-700",
        rowClassName: "border-sky-200/70 bg-sky-50/65",
      }
    : {
        label: "Custom",
        badgeClassName: "border border-amber-200/90 bg-amber-100/90 text-amber-800",
        rowClassName: "border-amber-200/70 bg-amber-50/55",
      };
}

function App() {
  const {
    projects,
    selectedProjectId,
    selectedTaskId,
    selectedAgentId,
    setProjects,
    selectProject,
    selectTask,
    selectAgent,
    applyEvent,
  } = useAgentFlowStore();
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [agentConfigPath, setAgentConfigPath] = useState<string | null>(null);
  const [optimisticSubmissions, setOptimisticSubmissions] = useState<OptimisticSubmission[]>([]);
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<Record<string, AgentRuntimeSnapshot>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;

    const refreshProjects = async () => {
      const snapshots = await window.agentFlow.bootstrap();
      if (!cancelled) {
        setProjects(snapshots);
      }
    };

    void refreshProjects();
    const unsubscribe = window.agentFlow.onAgentFlowEvent((event) => {
      applyEvent(event);
    });

    const timer = globalThis.setInterval(() => {
      void refreshProjects();
    }, 3000);

    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
      unsubscribe();
    };
  }, [applyEvent, setProjects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const activeTask = useMemo(
    () => activeProject?.tasks.find((task) => task.task.id === selectedTaskId),
    [activeProject, selectedTaskId],
  );

  const activeTaskView = useMemo<TaskSnapshot | undefined>(() => {
    if (!activeTask) {
      return activeTask;
    }

    const pending = optimisticSubmissions.filter((item) => item.taskId === activeTask.task.id);
    if (pending.length === 0) {
      return activeTask;
    }

    const runningAgents = new Set(
      pending.map((item) => item.mentionAgent).filter((agentName): agentName is string => Boolean(agentName)),
    );

    return {
      ...activeTask,
      messages: [...activeTask.messages, ...pending.map((item) => item.message)].sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp),
      ),
      agents: activeTask.agents.map((agent) =>
        runningAgents.has(agent.name) && agent.status === "idle"
          ? {
              ...agent,
              status: "running",
            }
          : agent,
      ),
    };
  }, [activeTask, optimisticSubmissions]);

  const agentCards = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    const taskAgents = new Map(activeTaskView?.agents.map((agent) => [agent.name, agent]) ?? []);
    return activeProject.agentFiles
      .map((agentFile) => {
        const runtime = taskAgents.get(agentFile.name);
        const runtimeSnapshot = runtimeSnapshots[agentFile.name];
        const roleSummary =
          agentFile.prompt
            .split(/\n+/)
            .map((line) => line.trim())
            .find((line) => line && !line.startsWith("你是")) ?? "点击后可查看完整 Agent 原始配置。";
        return {
          ...agentFile,
          displayName: getAgentDisplayName(agentFile.name),
          roleSummary,
          status: runtime?.status ?? "idle",
          messageCount: runtimeSnapshot?.messageCount ?? 0,
          isBuiltin: isBuiltinAgentPath(agentFile.relativePath),
        };
      })
      .sort(compareAgentDisplayOrder);
  }, [activeProject, activeTaskView, runtimeSnapshots]);

  const panelMappings = activeTaskView?.panels ?? [];
  const runtimePollKey = useMemo(
    () =>
      activeTaskView?.agents
        .map((agent) => `${agent.name}:${agent.status}:${agent.opencodeSessionId ?? ""}`)
        .join("|") ?? "",
    [activeTaskView],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setInterval> | null = null;

    async function loadRuntime() {
      if (!activeProject || !activeTaskView) {
        if (!cancelled) {
          setRuntimeSnapshots({});
        }
        return;
      }

      try {
        const snapshots = await window.agentFlow.getTaskRuntime({
          projectId: activeProject.project.id,
          taskId: activeTaskView.task.id,
        });

        if (cancelled) {
          return;
        }

        setRuntimeSnapshots(Object.fromEntries(snapshots.map((snapshot) => [snapshot.agentId, snapshot])));
      } catch {
        if (!cancelled) {
          setRuntimeSnapshots({});
        }
      }
    }

    if (!activeProject || !activeTaskView) {
      setRuntimeSnapshots({});
      return () => {
        cancelled = true;
      };
    }

    void loadRuntime();

    if (activeTaskView.agents.some((agent) => agent.opencodeSessionId)) {
      timer = globalThis.setInterval(() => {
        void loadRuntime();
      }, 1500);
    }

    return () => {
      cancelled = true;
      if (timer) {
        globalThis.clearInterval(timer);
      }
    };
  }, [activeProject, activeTaskView, runtimePollKey]);

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden text-foreground">
        <div className="window-drag-region h-8 shrink-0" />

        <main className="min-h-0 flex-1 overflow-hidden px-5 pb-5">
          <div className="grid h-full overflow-hidden grid-cols-[320px_minmax(0,1fr)] gap-[10px]">
            <SidebarList
              projects={projects}
              selectedProjectId={selectedProjectId}
              selectedTaskId={selectedTaskId}
              onSelectProject={selectProject}
              onSelectTask={selectTask}
              onDeleteTask={async (projectId, taskId) => {
                await window.agentFlow.deleteTask({
                  projectId,
                  taskId,
                });
              }}
              onCreateProject={async (path) => {
                await window.agentFlow.createProject({ path });
              }}
            />

            <div className="grid min-h-0 overflow-hidden grid-rows-[minmax(360px,46%)_minmax(0,1fr)] gap-[10px]">
              <TopologyGraph
                project={activeProject}
                task={activeTaskView}
                selectedAgentId={selectedAgentId}
                runtimeSnapshots={runtimeSnapshots}
                showEdgeList={false}
                onSelectAgent={(agentId) => {
                  selectAgent(agentId);
                }}
                onSaveTopology={async (topology) => {
                  if (!activeProject) {
                    return;
                  }
                  await window.agentFlow.saveTopology({
                    projectId: activeProject.project.id,
                    topology,
                  });
                }}
              />

              <div className="grid min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)_minmax(380px,420px)] gap-[10px]">
                <div className="min-h-0">
                  <ChatWindow
                    project={activeProject}
                    task={activeTaskView}
                    availableAgents={activeProject?.agentFiles.map((agent) => agent.name) ?? []}
                    onOpenTaskSession={async () => {
                      if (!activeProject || !activeTaskView) {
                        return;
                      }
                      await window.agentFlow.openTaskSession({
                        projectId: activeProject.project.id,
                        taskId: activeTaskView.task.id,
                      });
                    }}
                    onSubmit={async ({ content, mentionAgent }) => {
                      if (!activeProject) {
                        return;
                      }
                      let optimisticId: string | null = null;
                      if (activeTask) {
                        optimisticId = globalThis.crypto.randomUUID();
                        setOptimisticSubmissions((current) => [
                          ...current,
                          {
                            id: optimisticId,
                            taskId: activeTask.task.id,
                            mentionAgent,
                            message: {
                              id: optimisticId,
                              projectId: activeProject.project.id,
                              taskId: activeTask.task.id,
                              sender: "user",
                              content,
                              timestamp: new Date().toISOString(),
                              meta: {
                                optimistic: "true",
                              },
                            },
                          },
                        ]);
                      }
                      try {
                        await window.agentFlow.submitTask({
                          projectId: activeProject.project.id,
                          taskId: activeTask?.task.id ?? null,
                          content,
                          mentionAgent,
                        });
                      } finally {
                        if (optimisticId) {
                          setOptimisticSubmissions((current) =>
                            current.filter((item) => item.id !== optimisticId),
                          );
                        }
                      }
                    }}
                  />
                </div>

              <aside className="PANEL-surface flex min-h-0 flex-col overflow-hidden rounded-[10px] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-[1.45rem] font-bold text-primary">
                      团队成员 {agentCards.length > 0 ? agentCards.length : ""}
                    </p>
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  <span className="rounded-[6px] bg-card px-3 py-1 text-[11px] text-foreground/80">
                    {activeTaskView ? `当前 Task · ${activeTaskView.task.title}` : "当前还没有选中 Task"}
                  </span>
                  {activeTaskView && (
                    <span className="rounded-[6px] bg-card px-3 py-1 text-[11px] text-foreground/80">
                      入口 {getAgentDisplayName(activeTaskView.task.entryAgentId)}
                    </span>
                  )}
                  <span className="rounded-[6px] bg-card px-3 py-1 text-[11px] text-foreground/80">
                    {panelMappings.length > 0
                      ? `${panelMappings.length} 个 panel 已绑定`
                      : "当前还没有 panel 绑定记录"}
                  </span>
                </div>

                <div className="min-h-0 overflow-y-auto rounded-[8px] border border-border/60 bg-card/80 px-2">
                  {agentCards.map((agent) => {
                    const mappedPanel = panelMappings.find((panel) => panel.agentName === agent.name);
                    const kindMeta = getAgentKindMeta(agent.isBuiltin);
                    return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        if (!agent.relativePath.startsWith("builtin://")) {
                          setAgentConfigPath(agent.relativePath);
                          setAgentConfigOpen(true);
                        }
                      }}
                      className={`flex w-full items-center gap-3 border-b px-3 py-3 text-left transition last:border-b-0 ${
                        kindMeta.rowClassName
                      } ${agent.relativePath.startsWith("builtin://") ? "" : "hover:brightness-[0.99]"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <div className="min-w-0 flex-1 py-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="min-w-0 break-all text-[15px] font-semibold leading-5 text-foreground">
                                {agent.displayName}
                              </p>
                              <span
                                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${kindMeta.badgeClassName}`}
                              >
                                {kindMeta.label}
                              </span>
                            </div>
                            {mappedPanel && (
                              <div className="mt-1 break-all text-[11px] text-muted-foreground">
                                {mappedPanel.paneId}
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span
                              className={`rounded-[6px] px-2.5 py-1 text-[11px] ${getAgentStatusClassName(agent.status)}`}
                            >
                              {getAgentMetricLabel(agent.messageCount)}
                            </span>
                            {activeTaskView && mappedPanel && (
                              <button
                                type="button"
                                className="rounded-[6px] border border-border/60 bg-white/80 px-2.5 py-1 text-[11px] text-foreground/80 transition hover:border-primary"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void window.agentFlow.selectAgentPANEL(
                                    activeProject!.project.id,
                                    activeTaskView.task.id,
                                    agent.name,
                                  );
                                }}
                              >
                                PANEL
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                    );
                  })}

                  {!activeProject && (
                    <div className="rounded-[8px] border border-dashed border-border bg-card/50 px-4 py-5 text-sm text-muted-foreground">
                      先创建或选择一个 Project。
                    </div>
                  )}
                </div>
                </aside>
              </div>
            </div>
          </div>
        </main>
      </div>

      <AgentConfigModal
        project={activeProject}
        open={agentConfigOpen}
        selectedPath={agentConfigPath}
        onSelectPath={setAgentConfigPath}
        onOpenChange={setAgentConfigOpen}
      />
    </>
  );
}

export default App;
