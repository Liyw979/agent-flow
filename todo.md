# CWD 清理待办

## 可继续删除的实现项

- [x] 删除 [src/runtime/orchestrator.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/orchestrator.ts) 中 `createTask(cwd, ...)` 的 `cwd` 入参，改为直接使用 `this.cwd`
- [x] 删除 [src/runtime/orchestrator.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/orchestrator.ts) 中 `submitTask` / `initializeTask` 里仅用于继续传递的 `normalizedCwd` 局部变量
- [x] 删除 [src/runtime/orchestrator.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/orchestrator.ts) 中所有“先取 `this.cwd`，再只传给下游”的中转写法，改为方法内部直接读取

## 需要逐项复查是否还能继续收紧的实现项

- [x] 复查 [src/runtime/orchestrator.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/orchestrator.ts) 中与工作区快照构造相关的 `cwd` 使用，确认哪些是数据事实，哪些仍是冗余中转
- [x] 复查 [src/runtime/launch-context.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/launch-context.ts) 的 `launchCwd` 是否只作为启动事实存在，没有继续进入运行态路由
- [x] 复查 [src/cli/web-host.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/cli/web-host.ts) 和 [src/shared/types.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/shared/types.ts) 的 `launchCwd` / `WorkspaceSnapshot.cwd` 展示字段，确认它们只服务于 UI 展示，不参与运行态判断

## 保留但需要明确原因的项

- [x] 为 [src/shared/types.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/shared/types.ts) 中 `TaskRecord.cwd` 增加一次代码级复查说明，确认它表示任务所属工作区事实，而不是运行态索引键
- [x] 为 [src/shared/types.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/shared/types.ts) 中 `WorkspaceSnapshot.cwd` 增加一次代码级复查说明，确认它表示当前工作区展示事实
- [x] 为 [src/runtime/opencode-client.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/opencode-client.ts) 中 `startServer(cwd, ...)` 增加一次代码级复查说明，确认它是底层进程启动目录，不能删除
- [x] 为 [src/runtime/orchestrator.ts](/Users/liyw/.codex/worktrees/f980/agent-team/src/runtime/orchestrator.ts) 中进程级单 `cwd` 约束增加一次代码级复查说明，确认它是“一个进程只允许一个工作区”的保护条件

## 测试与文档同步

- [x] 清点测试中所有仅为旧 `cwd` 透传行为而存在的断言，删除已经失效的实现细节断言
- [x] 同步更新 [AGENTS.md](/Users/liyw/.codex/worktrees/f980/agent-team/AGENTS.md) 中仍提到旧 `cwd` 运行态职责或旧方法名的描述
- [x] 完成以上清理后，重新执行 `bun tsc --noEmit`、`bun test --only-failures`、`bun run knip --fix`
