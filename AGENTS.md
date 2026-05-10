## 1. 代码要求
- 追求代码熵减，追求代码量变少
- 涉及的方法入参、返回值是否最小化，一个方法只应该传入它需要的参数，比如能传入string，就不要传入一个包装类
- 新代码禁止出现null、undefined和 xxx? 等可空/可选字段，可空，可空返回值
- 避免兼容代码, 兜底代码，转换代码，额外状态，normalize方法等代码
- 新增的测试代码，能否直接合入已有的测试中，不要改一行代码，新增几百行测试

- 交付前必须先明确输出：原始任务、是否已经完成、任务完成的代码证据；证据不能只依赖单元测试。
- 每次交付前必须检查`bun tsc --noEmit` 与 `bun test --only-failures; bun run knip --fix`
- bug优先使用 `src/runtime/scheduler-script-emulator-migration.test.ts` 这类 script 测试直接验证真实对话流转，并优先复用现有 `config/team-topologies/*.json5` 或其编译结果。

## 2. 约束
- 禁用词：`收口`。新增或修改文案、注释、提示词、日志、界面文案时都不得使用该表述，统一改为含义更准确的描述。

## 3. 项目概览

- Agent Team 是面向 OpenCode 的单工作区 Task Code Agent 编排桌面工具。
- 当前系统围绕当前 `cwd` 下的团队拓扑、Task 会话、群聊记录与 Agent 运行态工作，数据模型使用工作区与 Task。
- GUI 主布局为：上方当前 Task 拓扑图，下方左侧当前 Task 群聊，右侧当前 Task Agent 列表；前端只负责展示与聊天发消息，不负责任何配置写入。
- CLI 与 GUI 复用同一套 `Orchestrator`、OpenCode 与文件存储逻辑。

## 环境配置
- 使用bun install下载依赖
- 前端开发或修改 UI 相关文件后，必须执行 `bun run build`，生成最新的 `dist/web/`，避免浏览器继续读取旧 UI 产物。
- `task ui` 只会读取已构建好的 `dist/web/` 或编译产物内嵌的网页资源；
