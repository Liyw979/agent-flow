# 跨平台兼容性问题移除计划

## 目标

移除当前评审中已经确认的两类问题：

1. Windows 打包版仍然打印仅适用于源码仓库的 `npm run cli -- task attach ...` 提示。
2. 当前交付链路只有 Windows 打包目标，没有 macOS 对应的打包产物与发布入口。

本计划只定义移除路径、验证方式与交付顺序，不在本文件中直接实施代码修改。

## 范围

涉及模块：

- `shared/terminal-commands.ts`
- `cli/index.ts`
- `cli/ui-host-launch.ts`
- `cli/launcher.cjs`
- `cli/launcher-spec.cjs`
- `package.json`
- `AGENTS.md`

涉及验证：

- CLI 单元测试
- 打包脚本可用性验证
- Windows / macOS 平台文案与命令生成验证

## 计划一：移除 Windows 打包版 attach 提示错误

### 现状证据

- `shared/terminal-commands.ts` 当前把 attach 提示固定写成 `npm run cli -- task attach ...`。
- `cli/index.ts` 的 `printTaskAttachCommands()` 直接复用该字符串输出给用户。
- 当前仓库的已定义打包产物是 `dist/agentflow.exe`，Windows 单文件版并不依赖仓库内 `package.json` 的 `npm run cli`。

### 目标状态

根据运行形态输出正确的 attach 提示：

- 源码运行态：继续输出 `npm run cli -- task attach <agentName> [--cwd ...]`
- 编译产物运行态：
  - Windows：输出 `agentflow.exe task attach <agentName> [--cwd ...]`
  - macOS：输出未来对应的可执行入口，例如 `agentflow task attach <agentName> [--cwd ...]` 或 `.app` 内统一封装后的 CLI 入口

### 修改步骤

1. 提炼“运行形态感知”的 attach 命令生成接口，不再把源码模式命令写死在共享 helper 里。
2. 在 CLI 层显式区分：
   - 源码模式
   - 编译模式
   - 编译模式下的 Windows / macOS 可执行名称
3. 让 `printTaskAttachCommands()` 只负责展示，不再自行拼接跨平台命令细节。
4. 保持 `task attach --print-only` 与群聊输出文案一致，避免两个入口命令不一致。
5. 同步更新测试，覆盖源码模式、Windows 编译模式、macOS 编译模式三类输出。
6. 更新 `AGENTS.md` 中的用户可见 attach 文案说明，避免文档继续误导。

### 验收标准

- 源码模式下，attach 提示仍然能在仓库根目录直接执行成功。
- Windows 编译模式下，输出中不再出现 `npm run cli`。
- 同一 Agent 的 attach 提示在 `task headless`、`task ui`、`task attach --print-only` 三个入口保持一致。
- 新增单元测试证明不同平台 / 不同运行形态下命令字符串正确。

## 计划二：补齐 macOS 打包链路

### 现状证据

- `package.json` 当前只有 `dist:win`，目标为 `bun-windows-x64`。
- `AGENTS.md` 只记录了 Windows 打包与 `dist/agentflow.exe` 的交付方式。
- 代码里虽然存在 `darwin` 分支，但仓库没有 macOS 对应的产物构建入口。

### 目标状态

仓库具备与 Windows 对等的 macOS 打包入口，并且文档明确说明两种平台的产物与使用方式。

### 修改步骤

1. 明确 macOS 交付形态：
   - 单二进制 CLI
   - 或者桌面 `.app` + 内置 CLI 入口
2. 选定与现有 Windows 方案兼容的构建方式，并确认 Bun 当前是否支持目标平台产物：
   - Apple Silicon
   - Intel macOS
3. 在 `package.json` 增加 macOS 构建脚本，命名与现有 `dist:win` 保持对称。
4. 如需区分芯片架构，补充：
   - `dist:mac-arm64`
   - `dist:mac-x64`
   - 或统一 `dist:mac`
5. 让编译态命令展示逻辑读取真实产物名称，避免 Windows / macOS 共用错误文案。
6. 更新 `AGENTS.md` 的打包章节，写清：
   - macOS 产物位置
   - 运行方式
   - 是否需要签名、公证、权限放行
7. 增加针对打包脚本存在性的测试或最小 smoke check，避免后续再次退化为仅 Windows 可打包。

### 验收标准

- `package.json` 中存在可执行的 macOS 打包脚本。
- 文档同时覆盖 Windows 与 macOS 的打包产物与运行方式。
- 编译态 attach 提示能够根据真实平台产物给出正确命令。
- 至少有一条测试或脚本检查能阻止“只剩 dist:win、没有 macOS 构建入口”的回归。

## 实施顺序

1. 先处理计划一，因为它是已经影响 Windows 打包用户使用的直接错误。
2. 再处理计划二，因为它属于交付链路缺口，需要先决定 macOS 产物形态。
3. 计划二落地后，再回头收敛计划一中的 macOS 编译态命令文案，确保最终文案使用真实产物名。

## 风险与控制

### 风险一：不同运行形态下命令来源再次分叉

控制方式：

- 统一收敛到单一的“attach 命令规格生成函数”。
- 测试同时覆盖源码态与编译态。

### 风险二：macOS 打包脚本存在但实际不可用

控制方式：

- 在本机或 CI 至少执行一次最小 smoke build。
- 文档写明架构限制与前置依赖。

### 风险三：文档与实现再次脱节

控制方式：

- 本次修改必须同步更新 `AGENTS.md`。
- 将打包脚本名与产物名纳入测试或静态检查范围。

## 完成定义

满足以下条件后，视为本次问题移除完成：

1. Windows 编译版不再向用户展示 `npm run cli -- task attach ...`
2. 仓库具备明确的 macOS 打包入口
3. 文档已同步
4. 相关测试通过
