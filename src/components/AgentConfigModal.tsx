import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ProjectSnapshot } from "@shared/types";

interface AgentConfigModalProps {
  project: ProjectSnapshot | undefined;
  open: boolean;
  selectedPath: string | null;
  onOpenChange: (open: boolean) => void;
  onSelectPath: (path: string) => void;
}

export function AgentConfigModal({
  project,
  open,
  selectedPath,
  onOpenChange,
  onSelectPath,
}: AgentConfigModalProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const editableAgents = useMemo(
    () => project?.agentFiles.filter((agent) => !agent.relativePath.startsWith("builtin://")) ?? [],
    [project],
  );

  useEffect(() => {
    if (!selectedPath && editableAgents[0]) {
      onSelectPath(editableAgents[0].relativePath);
    }
  }, [editableAgents, onSelectPath, selectedPath]);

  const selectedFile = useMemo(
    () => editableAgents.find((agent) => agent.relativePath === selectedPath),
    [editableAgents, selectedPath],
  );

  useEffect(() => {
    if (selectedFile) {
      setDraft(selectedFile.content);
    }
  }, [selectedFile]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/25" />
        <Dialog.Content className="PANEL-surface fixed left-1/2 top-1/2 flex h-[min(760px,88vh)] w-[min(1080px,94vw)] min-h-0 -translate-x-1/2 -translate-y-1/2 flex-col rounded-[10px] p-6">
          <Dialog.Title className="font-display text-2xl font-bold text-primary">
            .opencode/agents 文件编辑器
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            直接编辑项目工作目录下的 Markdown Agent 文件，保存后会刷新 Project 视图与后续 Task 配置。
          </Dialog.Description>

          <div className="mt-6 grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4">
            <div className="min-h-0 rounded-[8px] border border-border bg-card/80 p-3">
              <div className="h-full space-y-2 overflow-y-auto">
                {editableAgents.map((agent) => (
                  <button
                    key={agent.relativePath}
                    type="button"
                    onClick={() => {
                      onSelectPath(agent.relativePath);
                      onOpenChange(true);
                      setDraft(agent.content);
                    }}
                    className={`w-full rounded-[8px] border px-3 py-3 text-left transition ${
                      selectedPath === agent.relativePath
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-white/70 hover:border-accent"
                    }`}
                  >
                    <p className="text-sm font-semibold">{agent.name}</p>
                    <p className="mt-1 text-[11px] opacity-75">{agent.mode}</p>
                  </button>
                ))}
                {editableAgents.length === 0 && (
                  <div className="rounded-[8px] border border-dashed border-border bg-white/50 px-3 py-4 text-sm text-muted-foreground">
                    当前没有可编辑的本地 Agent 文件。OpenCode 内置 build agent 不在这里编辑。
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col rounded-[8px] border border-border bg-card/80 p-4">
              <div className="mb-3">
                <p className="font-semibold text-primary">{selectedFile?.relativePath ?? "未选择文件"}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedFile
                    ? "OpenCode 源码兼容格式：YAML frontmatter + Markdown prompt"
                    : "这里只编辑项目工作目录下的 Markdown Agent 文件。"}
                </p>
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!selectedFile}
                className="min-h-0 flex-1 resize-none rounded-[8px] border border-border bg-[#172019] px-4 py-4 font-mono text-sm leading-6 text-[#F4EFE6] outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-3 border-t border-border/60 pt-4">
            <button
              type="button"
              className="rounded-[8px] border border-border px-4 py-2 text-sm"
              onClick={() => setDraft(selectedFile?.content ?? "")}
            >
              恢复文件内容
            </button>
            <button
              type="button"
              disabled={!project || !selectedFile || saving}
              className="rounded-[8px] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              onClick={async () => {
                if (!project || !selectedFile) {
                  return;
                }
                setSaving(true);
                try {
                  await window.agentFlow.saveAgentFile({
                    projectId: project.project.id,
                    relativePath: selectedFile.relativePath,
                    content: draft,
                  });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "保存中..." : "保存 Agent 文件"}
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-[8px] border border-border px-4 py-2 text-sm"
              >
                关闭
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
