# PLANS

## 目标
彻底移除 `continue/complete` 语义与命名，统一改为按 `trigger` 字面值路由。

系统后续只看两件事：
- 当前 Agent 返回了哪个 `trigger`
- 当前 `source` 下有哪些边命中这个 `trigger`

`<continue>` / `<complete>` 以后只是普通示例 label，不再有任何内置含义。  
回流链路只通过中性字段 `maxTriggerRounds` 声明。

## 任务清单

### 1. 共享类型与命名去语义化
- [x] 删除共享层 `Decision = "complete" | "continue" | "invalid"`
- [x] 删除 `COMPLETE_TOPOLOGY_TRIGGER`、`CONTINUE_TOPOLOGY_TRIGGER`
- [x] 删除 `resolveTopologyTriggerRouteKind`、`collectTopologyTriggerRoutes` 及相关二次分类工具
- [x] 将 `AgentStatus` 中的 `"continue"` 改为 `"action_required"` 或移除该分支
- [x] 将 `TaskStatus` 中的 `"continue"` 改为 `"action_required"` 或移除该分支
- [x] 将所有 `maxTriggerRounds` 类型与字段重命名为 `maxTriggerRounds`
- [x] 清理共享层里所有仍以 `continue/complete` 命名的工具函数、常量、注释和报错文本
- [x] 收紧 `TopologyLangGraphEndNode.incoming` 为必填数组，并将 trigger 路由收敛到显式 `endIncoming` 输入
- [x] 删除 `TOPOLOGY_TRIGGER_ROUTE_CACHE` / `cacheTopologyTriggerShapes` 隐式缓存，统一按显式 `edges + endIncoming` 计算 trigger 路由

### 2. 解析器与结果模型改造
- [x] 保持 `ParsedDecision` 只表达 `kind: "valid" | "invalid"` 与 `trigger?: string`
- [x] 保证非 decision agent 固定视为返回 `<default>`
- [x] 保证 decision agent 只能从当前 source 可用 trigger 集合中返回字面值
- [x] 将 `GraphAgentResult` 从 `decision` 二值语义改为 `trigger` + `routingKind`
- [x] 将 `routingKind` 固定为 `"default" | "labeled" | "invalid"`
- [x] 清理 orchestrator、decision parser、脚本模拟器里所有 `"complete" | "continue"` 分支判断
- [x] 将 `GraphAgentResult` 核心模型里的 `messageId` 收紧为必填，并把缺省值归一化前移到入口层

### 3. 拓扑编译与路由规则改造
- [x] 用 `maxTriggerRounds` 重新表达回流链路定义
- [x] 对同一 `(source, trigger)` 增加编译期校验：不允许同时命中带 `maxTriggerRounds` 和不带 `maxTriggerRounds` 的边
- [x] 非 decision agent 的 `<default>` handoff 继续保留为唯一普通保留 trigger
- [x] decision agent 的普通 labeled dispatch 改为完全按 trigger 字面值命中边
- [x] action-required 回流改为完全按 trigger 字面值命中且要求命中边全部带 `maxTriggerRounds`
- [x] `__end__` 结束条件改为只按 trigger 字面值命中
- [x] 清理 `compileTopology`、runtime topology、team DSL 中所有 complete/continue 分桶逻辑
- [x] 为内置 development topology 的 decisionAgent 显式补齐成功 trigger 路由，并确保 prompt 只允许输出已声明 trigger

### 4. 调度器与运行时状态改造
- [x] 重构 `gating-router`，不再按 `result.decision === "continue"/"complete"` 分支
- [x] 重构 `gating-scheduler`，统一为 `default` / `labeled` / `action-required` 三类派发
- [x] 重构批处理 continuation 和 repair 流程，使其仅依赖 trigger 与命中边形态
- [x] 将所有 loop limit 逻辑统一迁移到 `maxTriggerRounds`
- [x] 清理运行时错误信息中的 `continue/complete` 语义词汇
- [x] 确认 `action_required` 状态与 finished/failed 状态的边界完全由实际路由结果决定
- [x] 移除 `action_required` 的“首目标”假设，改为记录并派发整组命中的修复目标
- [x] 抽取统一的 `action_required` 派发 helper，并移除超限升级链路里重新引入的可空读取
- [x] 删除 `allowDirectFallbackWhenNoBatch` / `trigger_fallback_decision` 特例，首轮 action-required 直接按当前 request 派发
- [x] 将 `GatingBatchContinuation` 收紧为判别联合，并去掉 `repairDecisionAgentId` optional 读法
- [x] 将 `sourceMessageId` 从空字符串哨兵改为显式空值，移除运行时 `""` 回退路径
- [x] 将 action-required 到 spawn 的“机器输入”和展示文本分离，避免把 `opinion` 误当作 spawn items 输入
- [x] 删除 spawn items 的自然语言 fallback，统一要求显式 `items` JSON

### 5. 消息与前端展示改造
- [x] 统一 `action-required-request` 命名，清理 `continue-request` 残留
- [x] 将 `agent-final` 持久化记录从 `decision` 改为 `trigger` 与 `routingKind`
- [x] 更新 `chat-messages` 的合并逻辑，移除对 `decision === "continue"` 的特殊处理
- [x] 更新 `agent-history`、`task-lifecycle-rules`、UI 状态展示，使其只读取中性状态与 trigger
- [x] 清理前端与共享展示层中的 `continue/complete` 命名与文案
- [x] 确保用户可见语义仍正确表达“需要继续回应”与“本轮结束”，但不再绑定两个固定标签

### 6. 内置拓扑、DSL 与文档同步
- [x] 将内置 topology JSON 中所有 `maxTriggerRounds` 改为 `maxTriggerRounds`
- [x] 保留 `<continue>` / `<complete>` 作为示例 label，但文档里不再描述为内置 canonical 语义
- [x] 更新 `AGENTS.md` 中关于 trigger、回流、调度、状态的说明
- [x] 更新 `config/team-topologies/README.md` 中关于 trigger 与回流字段的说明
- [x] 清理 DSL 测试辅助代码中的 `continue/complete` 语义映射
- [x] 确认不会再引入 `decision`、`edgeType` 等新语义字段
- [x] 同步内置漏洞拓扑 prompt，使触发 spawn 的 finding 输出显式 `items` JSON

### 7. 测试改造与回归覆盖
- [x] 先统一更新所有测试夹具，把回流边字段改成 `maxTriggerRounds`
- [x] 删除或重写所有断言内部 `"complete" | "continue"` 状态的测试
- [x] 增加 `<revise>` 命中带 `maxTriggerRounds` 的边并触发 `action_required` 的回归测试
- [x] 增加 `<approved>` 命中普通 labeled 下游的回归测试
- [x] 增加 `<done>` 命中 `__end__` 的回归测试
- [x] 增加 `<continue>` / `<complete>` 当普通 label 使用时没有特殊待遇的回归测试
- [x] 增加同一 `(source, trigger)` 混用带/不带 `maxTriggerRounds` 时编译失败的回归测试
- [x] 优先在 script/emulator 测试中覆盖真实用户可见调度语义
- [x] 清理测试标题中仍把 `<continue>` / `<complete>` 当固定语义的表述
- [x] 为内置 development topology 增加 trigger 语义断言与完整成功流转回归
- [x] 删除与 script/emulator 重复证明同一用户语义的 router 层回归测试
- [x] 清理测试夹具里的 `decisionNote` / `DECISION_CONTINUE_*` 等旧语义别名
- [x] 清理 `responseNoteAlias`、旧 `allowDirectFallbackWhenNoBatch` 和空字符串 `messageId/sourceMessageId` 夹具
- [x] 清理 script / orchestrator / router 用例里旧 `completeSignal` / `continueSignal` 命名
- [x] 清理 `topology-test-dsl` 对 `"transfer"` 的兼容别名，并把相关测试改成显式 `<default>`
- [x] 将所有 spawn 相关测试输入改成显式 `{"items":[...]}`，不再依赖自然语言 fallback
- [x] 跑通 `bun x tsc --noEmit`
- [x] 跑通 `bun test --only-failures`
- [x] 跑通 `bun run knip --fix`

### 8. Reviewer 闭环
- [x] 完成一轮实现后调用 `reviewer`
- [x] 根据 reviewer 意见继续修改
- [x] 将 `action_required` 派发改成目标级 job payload，避免 spawn 与普通 agent 共用同一份正文
- [x] 去掉 `spawn-items` / `gating-router` / `orchestrator` 中的自然语言兜底与空 items 补救路径
- [x] 清理 `topology-test-dsl` 的 legacy `edges` 分支，并把测试侧转换迁移到本地辅助层
- [x] 清理 `task-snapshot-reconciliation.test.ts`、`orchestrator-pure.test.ts`、`types.test.ts` 中的类型欺骗
- [x] 重新跑通 `bun x tsc --noEmit`
- [x] 重新跑通 `bun test --only-failures`
- [x] 重新跑通 `bun run knip --fix`
- [x] 删除 decision-response 对 bare trigger / leading trigger 的宽松兼容解析，只接受显式结构化 trigger 块
- [x] 修正 spawn 汇总时对“子图终局节点”的识别，避免把回到外层的 report 边误算成子图内部出边
- [x] 去掉 orchestrator 内部无业务价值的 parseDecision / stripStructuredSignals 转发包装
- [x] 去掉 transfer job 上无用的可空 `sourceMessageId`
- [x] 再次跑通 `bun x tsc --noEmit`
- [x] 再次跑通 `bun test --only-failures`
- [x] 再次跑通 `bun run knip --fix`
- [x] 修改后重新调用 `reviewer`
- [ ] 取得 reviewer 明确“没有新的意见”回执
- 说明：此处只记录“已执行过 reviewer 回合”，是否已无新意见以独立 reviewer 回执为准，不在计划复选框中宣称闭环。

## 执行规则
- [x] 每完成一项任务，立即更新本文件对应复选框状态
- [x] 若某项任务拆出新的强依赖子任务，直接在对应小节追加新的复选框
- [x] 不允许保留 `maxTriggerRounds` 兼容逻辑
- [x] 不允许保留 `complete/continue` 内置语义分发逻辑

### 9. 新增尾项
- [x] 删除 `src/runtime/gating-router.test.ts` 中残余的旧 decision 映射夹具
- [x] 删除 `src/runtime/gating-router.test.ts` 中的 `normalizeLegacyContinueTopology`，并把相关回流边改为显式 `maxTriggerRounds`
- [x] 清理 `src/runtime/chat-messages.test.ts`、`src/runtime/task-snapshot-reconciliation.test.ts`、`src/runtime/orchestrator-pure.test.ts` 等测试工厂里的 `decision -> trigger` 推导
- [x] 清理 `src/runtime/scheduler-script-emulator*.test.ts` 与 `src/runtime/topology-test-dsl.test.ts` 中残余的 `continue/complete` 语义短别名
- [x] 修复 `src/runtime/gating-router.test.ts` 中测试辅助对 `messageId` 的隐式依赖，改为显式构造 `GraphAgentResult`
- [x] 修复 `src/runtime/chat-messages.test.ts` 中对非结构化孤立结束标签的旧断言，使其与严格 trigger 标记规则一致
- [x] 在上述修复后重新跑通 `bun x tsc --noEmit`
- [x] 在上述修复后重新跑通 `bun test --only-failures`
- [x] 在上述修复后重新跑通 `bun run knip --fix`
- [x] 按 reviewer 意见拆掉 `src/runtime/chat-messages.test.ts` 的宽口径 `createMessage` 工厂，改成按 kind 的窄 helper
- [x] 移除 `src/runtime/chat-messages.test.ts` 中 `action-required-request` 对 `["<continue>", "<complete>"]` 的旧 trigger 预清洗
- [x] 保持 `agent-final` 测试夹具显式区分展示正文与 `rawResponse`，只模拟真实结构化 trigger 落库形态
- [x] 修正 `PLANS.md`，确保 reviewer 闭环状态按真实进度表达，不提前宣称完成
- [x] 统一 `src/runtime/chat-messages.test.ts` 中 labeled agent-final 的输入形态，显式用结构化 trigger 原文驱动真实展示正文
- [x] 修正 `src/runtime/chat-messages.test.ts` 中测试标题与输入夹具不一致的表述
- [x] 删除 `src/runtime/chat-messages.test.ts` 中依赖 optional 输入和 helper 内 normalize 的测试夹具，改为显式传入 `content/rawResponse/responseNote/trigger`
- [x] 将非结构化孤立结束标签场景从伪 labeled 夹具改回真实 default agent-final 场景
- [x] 修正 `src/runtime/orchestrator.test.ts` 中受最新群聊卡片语义影响的转发断言
- 说明：本节只记录该批修复项本身；是否还有新的 reviewer 意见，统一以后续 reviewer 回执为准。

### 10. Reviewer 尾项修正
- [x] 修正 `AGENTS.md` 中仍引用旧 `.json` 扩展名、旧 CLI 示例与旧漏洞拓扑文件名的问题
- [x] 修正 `config/team-topologies/rfc-scanner.json5` 中残留的 `trigger_type`、`maxContinueRounds` 与旧 `transfer` 触发写法
- [x] 重新执行 `bun x tsc --noEmit`
- [x] 重新执行 `bun test`
- [x] 重新执行 `bun run knip --fix`
- [x] 修正 `AGENTS.md` 中被误改宽的 `JSON5` / `ensureJson5TopologyApplied` / `loadTeamDslDefinitionFile` 表述，恢复与 CLI 实现一致
- [x] 删除 `src/runtime/orchestrator.test.ts` 中与现有消息/纯转发测试重复且依赖异步时序的 `last-all` 集成断言，避免不稳定覆盖
- [x] 收紧 `src/runtime/orchestrator.test.ts` 与 `src/runtime/orchestrator-pure.test.ts` 顶部测试工厂：显式传入 `entry` / `writable`，删除 `orchestrator-pure` 的薄包装与无关 Git Diff 测试，并移除 reviewer 点名的可空输入与兜底解析

说明：reviewer 是否闭环以独立 reviewer 回执为准；若本文件保留未勾选的 reviewer 项，仅用于显式表达“尚未拿到无新意见回执”。

### 11. 本轮测试工厂收紧整改
- [x] 删除 `src/runtime/orchestrator-pure.test.ts` 中与 trigger 字面值路由和测试工厂收紧无关的 `createTestOrchestrator`、`renderDisplayContent` 及 3 条展示文案断言
- [x] 将 `src/runtime/orchestrator-pure.test.ts` 的总入口 `createMessage` 拆成按 kind 的窄 helper，并移除 sender 归一化、可选 `timestamp`、`trigger?: never` 与多分支路由包装
- [x] 将 `src/runtime/orchestrator.test.ts` 的 `buildCompletedExecutionResult` / `buildErrorExecutionResult` 改为 `messageId`、`timestamp` 显式必填，调用点直接传完整值
- [x] 将 `src/runtime/orchestrator.test.ts` 的 `buildTeamDslFromWorkspaceSnapshot` 改为直接读取 `workspace.agents`，不再通过可空读取加 `requirePresent` 做事后校验
- [x] 删除 `src/runtime/orchestrator.test.ts` 中与本轮 reviewer 目标无关的 `buildAgentExecutionPrompt` / `Project Git Diff Summary` helper 级测试
- [x] 接收最新 reviewer 回执，并继续按回执整改 `src/runtime/orchestrator.test.ts` 与 `PLANS.md`

说明：本节只记录上一轮已完成整改；reviewer 是否闭环，以下一轮独立回执为准。

### 12. 最新 reviewer 回执整改
- [x] 将 `src/runtime/orchestrator.test.ts` 的测试接缝收敛为统一 `TestOrchestrator` override 字段，删除 `TestOrchestratorInternals`
- [x] 删除 `src/runtime/orchestrator.test.ts` 中重复的 `as unknown as Orchestrator & {...}` 宽 cast，改为直接覆写真实公开属性
- [x] 删除纯转发的 `runAgentForTest`，并把受保护 `runAgent` 的访问收敛为单点、可审查 helper
- [x] 收紧注入配置与相关断言：移除 `InjectedAgentConfig.permission?`，不再在测试辅助层混用 `null / undefined`
- [x] 继续减少“先断言存在、后仍用可选链”的写法，优先改为显式失败分支
- [x] 修复 `TestOrchestrator` 测试接缝重构后引入的类型回归，补齐 graph 类型导入并统一 `reloadConfig` stub
- [ ] 等待 reviewer 明确“没有新的意见”回执

说明：本节只记录本轮已完成的具体整改；reviewer 是否闭环仍以后续独立回执为准。在拿到“没有新的意见”之前，相关待确认项保持未勾选状态。

### 13. Trigger Prompt 校验
- [x] 在 `compileTeamDsl` 新增编译期校验：某个 agent 只要存在非 `<default>` 的 outgoing trigger，这些 trigger 字面值必须显式出现在该 agent 自己的 prompt 中
- [x] 将校验递归应用到 spawn 子图 agent 与根图 `__end__` trigger，避免只校验根图普通边
- [x] 为缺少 trigger 字面值的 prompt 补充失败用例，并同步修正受影响的 DSL 测试夹具
- [x] 同步更新 [AGENTS.md](/Users/liyw/.codex/worktrees/f92f/agent-team/AGENTS.md) 与 [config/team-topologies/README.md](/Users/liyw/.codex/worktrees/f92f/agent-team/config/team-topologies/README.md)
- [x] 按最新 reviewer 回执复核本轮改动范围，仅保留 prompt / trigger 一致性校验相关整改
- [x] 按 reviewer 意见补齐两条精准失败回归：spawn 子图回外层 trigger、根图 `__end__` 自定义 trigger
- [x] 按 reviewer 意见确认 `team-dsl.ts` 中不再保留薄包装 trigger / `message_type` 解析辅助
- [ ] 等待本轮 reviewer 闭环

### 13. 最新 reviewer 再整改
- [x] 将 `src/runtime/orchestrator.test.ts` 的 5 组 override 字段与对应 `if` 分支改为构造期一次性注入的必填依赖对象，收紧 `TestOrchestrator` 审查面
- [x] 删除 `src/runtime/orchestrator.test.ts` 中的 `invokeRunAgent` 与 `as unknown as` 访问方式，改为 `StandaloneRunTestOrchestrator.runStandaloneAgent` 这一正式、收窄、可类型检查的测试调用面
- [x] 删除 `src/runtime/orchestrator.test.ts` 类字段层面的 `| undefined` override 状态，统一使用固定默认实现或显式依赖注入
- [x] 删除 `src/runtime/orchestrator.test.ts` 中重复的 override 回退 `super` 分支，改为依赖对象直接承接默认实现
- [x] 将 `src/runtime/orchestrator.test.ts` 中 `runtimeAgentIdFromContinue` 的读取改为线性失败即断言失败，不再制造中间空值
- [x] 修正 `src/runtime/team-dsl.ts` 中 `maxTriggerRounds` 的校验，改为基于归一化后的 `trigger` 判定，禁止 `" <default> "` 这类空白包裹值绕过校验
- [x] 补齐 `src/runtime/team-dsl.test.ts` 回归：`trigger: " <default> "` 与 `maxTriggerRounds` 组合必须编译失败
- [x] 修正 [config/team-topologies/README.md](/Users/liyw/.codex/worktrees/f92f/agent-team/config/team-topologies/README.md) 中残留的旧 `transfer` 触发表述，统一改成按 `"<default>"` 命中描述
- [ ] 等待 reviewer 明确“没有新的意见”回执

说明：本节同步记录本轮基于最新 reviewer 回执完成的具体整改；reviewer 闭环状态仍以后续独立回执为准，未拿到“没有新的意见”之前不得提前勾选。
