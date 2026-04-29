import test from "node:test";

import { assertAutoDerivedNegativeScripts } from "./scheduler-script-emulator";
import { createTopology as createTopologyCore } from "./topology-test-dsl";

function createTopology(...args: Parameters<typeof createTopologyCore>): ReturnType<typeof createTopologyCore> {
  return createTopologyCore(...args);
}

function renderTriggerBlock(trigger: string, content: string): string {
  return `${trigger}${content}</${trigger.slice(1, -1)}>`;
}

test("scheduler script drived 会基于真实核心轨迹自动派生开发团队 Build 判定脚本负例并统一断言失败", async () => {
  const topology = createTopology({
    downstream: {
      BA: { Build: "<default>" },
      Build: {
        CodeReview: "<default>",
        UnitTest: "<default>",
        TaskReview: "<default>",
      },
      CodeReview: {
        Build: { trigger: "<continue>", maxTriggerRounds: 4 },
        UnitTest: "<approved>",
        TaskReview: "<approved>",
      },
    },
  });

  const script = [
    "user: @BA 请先完成实现，再经过 CodeReview，多轮修复结束后再进入其他判定。",
    "BA: 需求已澄清，交给 Build 继续实现。 @Build",
    "Build: Build 首轮实现完成， @CodeReview @UnitTest @TaskReview",
    "CodeReview: CodeReview 首轮未通过。 @Build",
    "UnitTest: UnitTest 已收到首轮 Build 结果。",
    "TaskReview: TaskReview 已收到首轮 Build 结果。",
    "Build: Build 已根据 CodeReview 意见修复完成。 @CodeReview",
    "CodeReview: 已确认通过，可以进入后续判定。\n\n<approved>继续后续判定</approved> @UnitTest @TaskReview",
    "UnitTest: UnitTest 已收到最终 Build 结果。",
    "TaskReview: TaskReview 已收到最终 Build 结果。",
  ];

  await assertAutoDerivedNegativeScripts({
    topology,
    script,
  });
});

test("scheduler script drived 会基于真实核心轨迹自动派生 Implementer 多 decisionAgent 脚本负例并统一断言失败", async () => {
  const topology = createTopology({
    downstream: {
      Implementer: {
        UnitTest: "<default>",
        TaskReview: "<default>",
        CodeReview: "<default>",
      },
      UnitTest: {
        Implementer: { trigger: "<continue>", maxTriggerRounds: 4 },
        TaskReview: "<approved>",
        CodeReview: "<approved>",
      },
    },
  });

  const script = [
    "user: @Implementer 请完成这个需求",
    "Implementer: 第 1 轮实现完成 @UnitTest @TaskReview @CodeReview",
    "UnitTest: 第 1 轮单测未通过 @Implementer",
    `TaskReview: ${renderTriggerBlock("<complete>", "认可")}`,
    `CodeReview: ${renderTriggerBlock("<complete>", "认可")}`,
    "Implementer: 已修复第 1 轮问题 @UnitTest",
    "UnitTest: 第 2 轮单测未通过 @Implementer",
    "Implementer: 已修复第 2 轮问题 @UnitTest",
    "UnitTest: 当前结果已经达标，可以进入其余评审。\n\n<approved>认可</approved> @TaskReview @CodeReview",
    `TaskReview: ${renderTriggerBlock("<complete>", "认可")}`,
    `CodeReview: ${renderTriggerBlock("<complete>", "认可")}`,
  ];

  await assertAutoDerivedNegativeScripts({
    topology,
    script,
  });
});
