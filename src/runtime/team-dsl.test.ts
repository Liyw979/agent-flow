import assert from "node:assert/strict";
import test from "node:test";

import { buildTopologyNodeRecords, type SpawnRule, type SpawnRuleWithReport } from "@shared/types";

import {
  readBuiltinTopology,
} from "../../test-support/runtime/builtin-topology-test-helpers";
import {
  compileTeamDsl,
  matchesAppliedTeamDsl,
  matchesAppliedTeamDslAgents,
  matchesAppliedTeamDslTopology,
  type TeamDslDefinition,
} from "./team-dsl";

const BA_PROMPT = "你是 BA。";
const CODE_DECISION_PROMPT = "你是 CodeReview。必须输出 <continue> 或 <complete>。";
const UNIT_TEST_PROMPT = "你是 UnitTest。必须输出 <continue> 或 <complete>。";
const TASK_DECISION_PROMPT = "你是 TaskReview。必须输出 <continue> 或 <complete>。";

function expectReportRule(rule: SpawnRule | undefined): SpawnRuleWithReport {
  if (!rule || rule.report === false) {
    throw new Error("缺少 spawn report 配置");
  }
  return rule;
}

function promptWithTriggers(prompt: string, ...triggers: Array<`<${string}>`>): string {
  const normalizedTriggers = [...new Set(triggers)];
  if (normalizedTriggers.length === 0) {
    return prompt;
  }
  return `${prompt}\n允许输出 trigger：${normalizedTriggers.join("、")}`;
}

function agentNode(id: string, prompt: string, writable: boolean) {
  return {
    type: "agent" as const,
    id,
    system_prompt: prompt,
    writable,
  };
}

function spawnNode(id: string, graph: TeamDslDefinition) {
  return {
    type: "spawn" as const,
    id,
    graph,
  };
}

function link(
  from: string,
  to: string,
  trigger: `<${string}>`,
  message_type: "none" | "last",
  maxTriggerRounds?: number,
) {
  return {
    from,
    to,
    trigger,
    message_type,
    ...(typeof maxTriggerRounds === "number" ? { maxTriggerRounds } : {}),
  };
}

function endLink(
  from: string,
  trigger: `<${string}>`,
  message_type: "none" | "last",
) {
  return {
    from,
    to: "__end__" as const,
    trigger,
    message_type,
  };
}

function createDevelopmentGraphDsl() {
  return {
    entry: "BA",
    nodes: [
      agentNode("BA", BA_PROMPT, false),
      agentNode("Build", "", true),
      agentNode("CodeReview", CODE_DECISION_PROMPT, false),
      agentNode("UnitTest", UNIT_TEST_PROMPT, false),
      agentNode("TaskReview", TASK_DECISION_PROMPT, false),
    ],
    links: [
      link("BA", "Build", "<default>", "last"),
      link("Build", "CodeReview", "<default>", "last"),
      link("Build", "UnitTest", "<default>", "last"),
      link("Build", "TaskReview", "<default>", "last"),
      link("CodeReview", "Build", "<continue>", "last"),
      link("UnitTest", "Build", "<continue>", "last"),
      link("TaskReview", "Build", "<continue>", "last"),
    ],
  };
}

test("compileTeamDsl 支持把递归式图 DSL 编译成 agents + topology", () => {
  const compiled = compileTeamDsl({
    entry: "BA",
    nodes: [
      agentNode("Build", "", true),
      agentNode("BA", BA_PROMPT, false),
      agentNode("SecurityResearcher", promptWithTriggers("你负责漏洞挖掘。", "<continue>"), false),
    ],
    links: [
      link("BA", "Build", "<default>", "last"),
      link("Build", "SecurityResearcher", "<default>", "last"),
      link("SecurityResearcher", "Build", "<continue>", "last"),
    ],
  });

  assert.deepEqual(
    compiled.agents.map((agent) => ({
      id: agent.id,
      prompt: agent.prompt,
      templateName: agent.templateName,
      isWritable: agent.isWritable,
    })),
    [
      { id: "Build", prompt: "", templateName: "Build", isWritable: true },
      { id: "BA", prompt: BA_PROMPT, templateName: "BA", isWritable: false },
      { id: "SecurityResearcher", prompt: promptWithTriggers("你负责漏洞挖掘。", "<continue>"), templateName: "SecurityResearcher", isWritable: false },
    ],
  );
  assert.deepEqual(compiled.topology.edges, [
    { source: "BA", target: "Build", trigger: "<default>", messageMode: "last" },
    { source: "Build", target: "SecurityResearcher", trigger: "<default>", messageMode: "last" },
    { source: "SecurityResearcher", target: "Build", trigger: "<continue>", messageMode: "last" },
  ]);
  assert.deepEqual(compiled.topology.nodeRecords, [
    {
      id: "Build",
      kind: "agent",
      templateName: "Build",
      initialMessageRouting: { mode: "inherit" },
      prompt: "",
      writable: true,
    },
    {
      id: "BA",
      kind: "agent",
      templateName: "BA",
      initialMessageRouting: { mode: "inherit" },
      prompt: BA_PROMPT,
    },
    {
      id: "SecurityResearcher",
      kind: "agent",
      templateName: "SecurityResearcher",
      initialMessageRouting: { mode: "inherit" },
      prompt: promptWithTriggers("你负责漏洞挖掘。", "<continue>"),
    },
  ]);
});

test("compileTeamDsl 输出的 Agent 记录使用 id 字段而不是 name 字段", () => {
  const compiled = compileTeamDsl({
    entry: "Build",
    nodes: [
      agentNode("Build", "", true),
    ],
    links: [],
  });

  const agent = compiled.agents[0] as unknown as Record<string, unknown>;
  assert.equal(agent["id"], "Build");
  assert.equal(Object.prototype.hasOwnProperty.call(agent, "name"), false);
});

test("compileTeamDsl 不应把多个显式 writable 压缩成单个 Agent", () => {
  const compiled = compileTeamDsl({
    entry: "BA",
    nodes: [
      agentNode("Build", "", true),
      agentNode("BA", BA_PROMPT, true),
    ],
    links: [
      link("BA", "Build", "<default>", "last"),
    ],
  });

  assert.deepEqual(
    compiled.agents.map((agent) => ({
      id: agent.id,
      isWritable: agent.isWritable,
    })),
    [
      { id: "Build", isWritable: true },
      { id: "BA", isWritable: true },
    ],
  );
});

test("compileTeamDsl 不再支持旧的 agents + topology.downstream DSL", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        agents: [{ id: "Build" }],
        topology: {
          downstream: {},
        },
      } as never),
    /只支持递归式 entry \+ nodes \+ links DSL/u,
  );
});

test("compileTeamDsl 会拒绝非法的 node.type", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Build",
        nodes: [
          {
            type: "weird",
            id: "Build",
          },
        ],
        links: [],
      } as never),
    /nodes\[0\].*Invalid input/u,
  );
});

test("compileTeamDsl 会拒绝省略 agent.writable 的拓扑节点", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "BA",
        nodes: [
          {
            type: "agent",
            id: "BA",
            system_prompt: BA_PROMPT,
          },
        ],
        links: [],
      }),
    /nodes\[0\].*Invalid input/u,
  );
});

test("compileTeamDsl 会拒绝 tuple 形式的 links，要求显式 from to trigger message_type", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Build",
        nodes: [
          {
            type: "agent",
            id: "Build",
            system_prompt: "",
            writable: true,
          },
          {
            type: "agent",
            id: "BA",
            system_prompt: BA_PROMPT,
            writable: false,
          },
        ],
        links: [
          ["Build", "BA", "<default>", "last"],
        ],
      }),
    /from、to、trigger、message_type/u,
  );
});

test("compileTeamDsl 支持在拓扑文件里直接连接 __end__", () => {
  const definition: TeamDslDefinition = {
    entry: "Source",
    nodes: [
      agentNode("Source", promptWithTriggers("你负责 source。", "<continue>", "<complete>"), false),
      spawnNode(
        "Debate",
        {
          entry: "DecisionAgent",
          nodes: [
            agentNode("DecisionAgent", promptWithTriggers("你是 decisionAgent。", "<complete>"), false),
            agentNode("Summary", "你是 summary。", false),
          ],
          links: [
            link("DecisionAgent", "Summary", "<complete>", "last"),
          ],
        },
      ),
    ],
    links: [
      link("Source", "Debate", "<continue>", "last"),
      link("Debate", "Source", "<default>", "none"),
      endLink("Source", "<complete>", "none"),
    ],
  };
  const compiled = compileTeamDsl(definition);

  assert.deepEqual(compiled.topology.langgraph?.end, {
    id: "__end__",
    sources: ["Source"],
    incoming: [
      { source: "Source", trigger: "<complete>" },
    ],
  });
  assert.equal(compiled.topology.edges.some((edge) => edge.target === "__end__"), false);
});

test("compileTeamDsl 支持在 decision 边上声明自定义 trigger", () => {
  const compiled = compileTeamDsl({
    entry: "漏洞论证",
    nodes: [
      agentNode("漏洞论证", promptWithTriggers("你负责漏洞论证。", "<abcd>"), false),
      agentNode("漏洞挑战", "你负责漏洞挑战。", false),
    ],
    links: [
      {
        from: "漏洞论证",
        to: "漏洞挑战",
        trigger: "<abcd>",
        message_type: "last",
      },
    ],
  });

  assert.deepEqual(compiled.topology.edges, [
    {
      source: "漏洞论证",
      target: "漏洞挑战",
      trigger: "<abcd>",
      messageMode: "last",
    },
  ]);
});

test("compileTeamDsl 允许同一 source 把同一个自定义 trigger 路由到多个下游", () => {
  const compiled = compileTeamDsl({
    entry: "漏洞论证",
    nodes: [
      agentNode("漏洞论证", promptWithTriggers("你负责漏洞论证。", "<dup>"), false),
      agentNode("漏洞挑战", "你负责漏洞挑战。", false),
      agentNode("讨论总结", "你负责讨论总结。", false),
    ],
    links: [
      {
        from: "漏洞论证",
        to: "漏洞挑战",
        trigger: "<dup>",
        message_type: "last",
      },
      {
        from: "漏洞论证",
        to: "讨论总结",
        trigger: "<dup>",
        message_type: "last",
      },
    ],
  });

  assert.deepEqual(compiled.topology.edges, [
    {
      source: "漏洞论证",
      target: "漏洞挑战",
      trigger: "<dup>",
      messageMode: "last",
    },
    {
      source: "漏洞论证",
      target: "讨论总结",
      trigger: "<dup>",
      messageMode: "last",
    },
  ]);
});

test("compileTeamDsl 会拒绝引用未声明节点的 graph.links", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Build",
        nodes: [agentNode("Build", "", true)],
        links: [
          link("Build", "TaskReview", "<default>", "last"),
        ],
      }),
    /TaskReview/,
  );
});

test("compileTeamDsl 会拒绝缺少 system_prompt 且不是内置模板的自定义 agent", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "CustomPlanner",
        nodes: [
          {
            type: "agent",
            id: "CustomPlanner",
            system_prompt: "",
            writable: false,
          },
        ],
        links: [],
      }),
    /CustomPlanner/,
  );
});

test("compileTeamDsl 在单 Agent 且没有 links 时，仍然会把该 Agent 写入 topology 节点", () => {
  const compiled = compileTeamDsl({
    entry: "BA",
    nodes: [
      agentNode("BA", BA_PROMPT, false),
    ],
    links: [],
  });

  assert.deepEqual(compiled.topology.nodes, ["BA"]);
  assert.deepEqual(compiled.topology.nodeRecords, [
    {
      id: "BA",
      kind: "agent",
      templateName: "BA",
      initialMessageRouting: { mode: "inherit" },
      prompt: BA_PROMPT,
    },
  ]);
});

test("compileTeamDsl 会把 graph.entry 编译进 LangGraph START，并保持 END 为 null", () => {
  const compiled = compileTeamDsl(createDevelopmentGraphDsl());

  assert.deepEqual(compiled.topology.langgraph, {
    start: {
      id: "__start__",
      targets: ["BA"],
    },
    end: null,
  });
});

test("compileTeamDsl 支持从内置漏洞拓扑编译出论证挑战多轮 spawn 辩论拓扑", () => {
  const compiled = compileTeamDsl(readBuiltinTopology("vulnerability.json5"));

  assert.deepEqual(
    compiled.agents.map((agent) => agent.id),
    ["线索发现", "漏洞挑战", "漏洞论证", "讨论总结", "线索完备性评估"],
  );
  assert.deepEqual(compiled.topology.edges, [
    {
      source: "线索发现",
      target: "疑点辩论",
      trigger: "<continue>",
      messageMode: "last",
      maxTriggerRounds: 999,
    },
    {
      source: "线索发现",
      target: "线索完备性评估",
      trigger: "<complete>",
      messageMode: "last",
    },
    {
      source: "线索完备性评估",
      target: "线索发现",
      trigger: "<continue>",
      messageMode: "last",
      maxTriggerRounds: 4,
    },
  ]);
  assert.deepEqual(compiled.topology.spawnRules?.[0]?.spawnedAgents, [
    { role: "漏洞挑战", templateName: "漏洞挑战" },
    { role: "漏洞论证", templateName: "漏洞论证" },
    { role: "讨论总结", templateName: "讨论总结" },
  ]);
  const firstRule = expectReportRule(compiled.topology.spawnRules?.[0]);
  assert.equal(firstRule?.sourceTemplateName, "线索发现");
  assert.equal(firstRule.report.templateName, "线索发现");
  assert.equal(firstRule.report.trigger, "<default>");
  assert.equal(firstRule.report.messageMode, "none");
  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "讨论总结")?.initialMessageRouting,
    {
      mode: "list",
      agentIds: ["线索发现", "漏洞挑战", "漏洞论证"],
    },
  );
  assert.deepEqual(compiled.topology.langgraph?.end, {
    id: "__end__",
    sources: ["线索完备性评估"],
    incoming: [
      { source: "线索完备性评估", trigger: "<complete>" },
    ],
  });
  assert.deepEqual(compiled.topology.spawnRules?.[0]?.edges, [
    { sourceRole: "漏洞论证", targetRole: "漏洞挑战", trigger: "<continue>", messageMode: "last", maxTriggerRounds: 4 },
    { sourceRole: "漏洞挑战", targetRole: "漏洞论证", trigger: "<continue>", messageMode: "last", maxTriggerRounds: 4 },
    { sourceRole: "漏洞论证", targetRole: "讨论总结", trigger: "<complete>", messageMode: "last" },
    { sourceRole: "漏洞挑战", targetRole: "讨论总结", trigger: "<complete>", messageMode: "last" },
  ]);
});

test("compileTeamDsl 会拒绝在 spawn 子图里直接连接 __end__", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Source",
        nodes: [
          agentNode("Source", promptWithTriggers("你负责 source。", "<default>"), false),
          spawnNode(
            "Debate",
            {
              entry: "DecisionAgent",
              nodes: [
                agentNode("DecisionAgent", promptWithTriggers("你是 decisionAgent。", "<complete>"), false),
              ],
              links: [
                endLink("DecisionAgent", "<complete>", "none"),
              ],
            },
          ),
        ],
        links: [
          link("Source", "Debate", "<default>", "last"),
        ],
      }),
    /只有根图可以直接连接 __end__/u,
  );
});

test("__end__ 边支持复用示例 trigger label 作为条件分支", () => {
  const compiled = compileTeamDsl({
    entry: "Source",
    nodes: [
      agentNode("Source", promptWithTriggers("你负责 source。", "<continue>", "<complete>"), false),
      agentNode("Debate", "你负责 debate。", false),
    ],
    links: [
      link("Source", "Debate", "<continue>", "last"),
      endLink("Source", "<complete>", "none"),
    ],
  });

  assert.deepEqual(compiled.topology.langgraph?.end, {
    id: "__end__",
    sources: ["Source"],
    incoming: [
      { source: "Source", trigger: "<complete>" },
    ],
  });
});

test("compileTeamDsl 支持为 __end__ 边声明自定义 trigger", () => {
  const compiled = compileTeamDsl({
    entry: "漏洞论证",
    nodes: [
      agentNode("漏洞论证", promptWithTriggers("你负责漏洞论证。", "<done>"), false),
    ],
    links: [
      {
        from: "漏洞论证",
        to: "__end__",
        trigger: "<done>",
        message_type: "none",
      },
    ],
  });

  assert.deepEqual(compiled.topology.langgraph?.end, {
    id: "__end__",
    sources: ["漏洞论证"],
    incoming: [
      { source: "漏洞论证", trigger: "<done>" },
    ],
  });
});

test("compileTeamDsl 会拒绝省略 __end__ 边的 trigger", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Source",
        nodes: [
          agentNode("Source", promptWithTriggers("你负责 source。", "<default>"), false),
        ],
        links: [
          {
            from: "Source",
            to: "__end__",
            message_type: "none",
          },
        ],
      }),
    /trigger/u,
  );
});

test("compileTeamDsl 会拒绝省略 __end__ 边的 message_type", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Source",
        nodes: [
          agentNode("Source", promptWithTriggers("你负责 source。", "<complete>"), false),
        ],
        links: [
          {
            from: "Source",
            to: "__end__",
            trigger: "<complete>",
          },
        ],
      }),
    /message_type/u,
  );
});

test("compileTeamDsl 支持在 links 上显式声明边级消息传递策略", () => {
  const compiled = compileTeamDsl({
    entry: "Source",
    nodes: [
      agentNode("Source", "你负责 source。", false),
      agentNode("Debate", "你负责 debate。", false),
      agentNode("Judge", "你负责 judge。", false),
    ],
    links: [
      link("Source", "Debate", "<default>", "last"),
      link("Debate", "Judge", "<default>", "last"),
      link("Judge", "Source", "<default>", "none"),
    ],
  });

  assert.deepEqual(compiled.topology.edges, [
    { source: "Source", target: "Debate", trigger: "<default>", messageMode: "last" },
    { source: "Debate", target: "Judge", trigger: "<default>", messageMode: "last" },
    { source: "Judge", target: "Source", trigger: "<default>", messageMode: "none" },
  ]);
});

test("compileTeamDsl 会保留示例回流 label 边上的 maxTriggerRounds 配置", () => {
  const compiled = compileTeamDsl({
    entry: "线索发现",
    nodes: [
      agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<continue>"), false),
      spawnNode(
        "疑点辩论",
        {
          entry: "漏洞挑战",
          nodes: [
            agentNode("漏洞挑战", promptWithTriggers("你负责漏洞挑战。", "<complete>"), false),
            agentNode("讨论总结", "你负责讨论总结。", true),
          ],
          links: [
            link("漏洞挑战", "讨论总结", "<complete>", "last"),
            link("讨论总结", "线索发现", "<default>", "none"),
          ],
        },
      ),
    ],
    links: [
      link("线索发现", "疑点辩论", "<continue>", "last", 999),
    ],
  });

  assert.deepEqual(compiled.topology.edges, [
    {
      source: "线索发现",
      target: "疑点辩论",
      trigger: "<continue>",
      messageMode: "last",
      maxTriggerRounds: 999,
    },
  ]);
});

test("compileTeamDsl 会保留 spawn 子图回到外层的示例回流 label 边 maxTriggerRounds 配置", () => {
  const compiled = compileTeamDsl({
    entry: "线索发现",
    nodes: [
      agentNode("线索发现", "你负责线索发现。", false),
      spawnNode(
        "疑点辩论",
        {
          entry: "讨论总结",
          nodes: [
            agentNode("讨论总结", promptWithTriggers("你负责讨论总结。", "<continue>"), true),
          ],
          links: [
            link("讨论总结", "线索发现", "<continue>", "none", 7),
          ],
        },
      ),
    ],
    links: [
      link("线索发现", "疑点辩论", "<default>", "last"),
    ],
  });

  const firstRule = expectReportRule(compiled.topology.spawnRules?.[0]);
  assert.equal(firstRule.report.trigger, "<continue>");
  assert.equal(firstRule.report.messageMode, "none");
  assert.equal(firstRule.report.maxTriggerRounds, 7);
});

test("compileTeamDsl 会拒绝旧的 all message_type", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "线索发现",
        nodes: [
          agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<default>"), false),
          agentNode("疑点辩论", "你负责辩论。", false),
        ],
        links: [
          {
            from: "线索发现",
            to: "疑点辩论",
            trigger: "<default>",
            message_type: "all",
          },
        ],
      } as never),
    /links\[0\]\.message_type/u,
  );
});

test("compileTeamDsl 支持在 agent 上声明 initialMessage 列表", () => {
  const compiled = compileTeamDsl({
    entry: "线索发现",
    nodes: [
      agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<complete>"), false),
      agentNode("漏洞讨论", promptWithTriggers("你负责漏洞讨论。", "<complete>"), false),
      {
        ...agentNode("线索完备性评估", "你负责线索完备性评估。", false),
        initialMessage: ["线索发现", "漏洞讨论"],
      },
    ],
    links: [
      {
        from: "线索发现",
        to: "漏洞讨论",
        trigger: "<complete>",
        message_type: "last",
      },
      {
        from: "漏洞讨论",
        to: "线索完备性评估",
        trigger: "<complete>",
        message_type: "last",
      },
    ],
  });

  assert.deepEqual(compiled.topology.edges, [
    {
      source: "线索发现",
      target: "漏洞讨论",
      trigger: "<complete>",
      messageMode: "last",
    },
    {
      source: "漏洞讨论",
      target: "线索完备性评估",
      trigger: "<complete>",
      messageMode: "last",
    },
  ]);
  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "线索完备性评估"),
    {
      id: "线索完备性评估",
      kind: "agent",
      templateName: "线索完备性评估",
      prompt: "你负责线索完备性评估。",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现", "漏洞讨论"],
      },
    },
  );
});

test("compileTeamDsl 会把 initialMessage 来源重排为 JSON 中 Agent 自上而下的定义顺序", () => {
  const compiled = compileTeamDsl({
    entry: "入口",
    nodes: [
      agentNode("入口", promptWithTriggers("你负责入口。", "<complete>"), false),
      agentNode("甲", promptWithTriggers("你负责甲。", "<complete>"), false),
      agentNode("乙", promptWithTriggers("你负责乙。", "<complete>"), false),
      {
        ...agentNode("总结", "你负责总结。", false),
        initialMessage: ["乙", "甲"],
      },
    ],
    links: [
      link("入口", "甲", "<complete>", "last"),
      link("甲", "乙", "<complete>", "last"),
      link("乙", "总结", "<complete>", "last"),
    ],
  });

  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "总结")?.initialMessageRouting,
    {
      mode: "list",
      agentIds: ["甲", "乙"],
    },
  );
});

test("compileTeamDsl 允许 initialMessage 引用同层后定义的 Agent，并按定义顺序重排", () => {
  const compiled = compileTeamDsl({
    entry: "入口",
    nodes: [
      agentNode("入口", promptWithTriggers("你负责入口。", "<complete>"), false),
      {
        ...agentNode("总结", "你负责总结。", false),
        initialMessage: ["乙", "甲"],
      },
      agentNode("甲", promptWithTriggers("你负责甲。", "<complete>"), false),
      agentNode("乙", promptWithTriggers("你负责乙。", "<complete>"), false),
    ],
    links: [
      link("入口", "甲", "<complete>", "last"),
      link("甲", "乙", "<complete>", "last"),
      link("乙", "总结", "<complete>", "last"),
    ],
  });

  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "总结")?.initialMessageRouting,
    {
      mode: "list",
      agentIds: ["甲", "乙"],
    },
  );
});

test("compileTeamDsl 支持在 agent 上声明空 initialMessage 列表", () => {
  const compiled = compileTeamDsl({
    entry: "线索完备性评估",
    nodes: [
      {
        ...agentNode("线索完备性评估", promptWithTriggers("你负责线索完备性评估。", "<complete>"), false),
        initialMessage: [],
      },
    ],
    links: [
      {
        from: "线索完备性评估",
        to: "__end__",
        trigger: "<complete>",
        message_type: "none",
      },
    ],
  });

  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "线索完备性评估"),
    {
      id: "线索完备性评估",
      kind: "agent",
      templateName: "线索完备性评估",
      prompt: promptWithTriggers("你负责线索完备性评估。", "<complete>"),
      initialMessageRouting: {
        mode: "none",
      },
    },
  );
});

test("compileTeamDsl 会拒绝 initialMessage 引用不存在的来源 Agent", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "线索发现",
        nodes: [
          agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<complete>"), false),
          {
            ...agentNode("线索完备性评估", "你负责线索完备性评估。", false),
            initialMessage: ["不存在的来源"],
          },
        ],
        links: [
          {
            from: "线索发现",
            to: "线索完备性评估",
            trigger: "<complete>",
            message_type: "last",
          },
        ],
      }),
    /initialMessage 引用了不存在的来源 Agent：不存在的来源/u,
  );
});

test("compileTeamDsl 支持 rfc-scanner 拓扑中的 spawn 子图 initialMessage 引用父图来源 Agent", () => {
  const compiled = compileTeamDsl(readBuiltinTopology("rfc-scanner.json5"));

  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "漏洞论证")?.initialMessageRouting,
    {
      mode: "list",
      agentIds: ["线索发现"],
    },
  );
});

test("compileTeamDsl 允许 spawn 子图引用外层显式可见 agent，但不会把 sibling spawn 内部 agent 视为全局可见", () => {
  const compiled = compileTeamDsl({
    entry: "线索发现",
    nodes: [
      agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<continue>"), false),
      spawnNode(
        "主辩论",
        {
          entry: "漏洞论证",
          nodes: [
            {
              ...agentNode("漏洞论证", promptWithTriggers("你负责漏洞论证。", "<continue>"), false),
              initialMessage: ["线索发现"],
            },
          ],
          links: [],
        },
      ),
    ],
    links: [
      {
        from: "线索发现",
        to: "主辩论",
        trigger: "<continue>",
        message_type: "last",
      },
    ],
  });

  assert.deepEqual(
    compiled.topology.spawnRules?.[0]?.spawnedAgents.find((agent) => agent.role === "漏洞论证"),
    {
      role: "漏洞论证",
      templateName: "漏洞论证",
    },
  );
  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "漏洞论证")?.initialMessageRouting,
    {
      mode: "list",
      agentIds: ["线索发现"],
    },
  );

  assert.throws(
    () =>
      compileTeamDsl({
        entry: "线索发现",
        nodes: [
          agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<continue>"), false),
          spawnNode(
            "主辩论",
            {
              entry: "漏洞论证",
              nodes: [
                {
                  ...agentNode("漏洞论证", promptWithTriggers("你负责漏洞论证。", "<continue>"), false),
                  initialMessage: ["旁路证据"],
                },
              ],
              links: [],
            },
          ),
          spawnNode(
            "旁路讨论",
            {
              entry: "旁路证据",
              nodes: [
                agentNode("旁路证据", promptWithTriggers("你负责旁路证据。", "<continue>"), false),
              ],
              links: [],
            },
          ),
        ],
        links: [
          {
            from: "线索发现",
            to: "主辩论",
            trigger: "<continue>",
            message_type: "last",
          },
          {
            from: "线索发现",
            to: "旁路讨论",
            trigger: "<continue>",
            message_type: "last",
          },
        ],
      }),
    /initialMessage 引用了不存在的来源 Agent：旁路证据/u,
  );
});

test("compileTeamDsl 会把 spawn 子图里混合父图与子图来源的 initialMessage 重排为全局定义顺序", () => {
  const compiled = compileTeamDsl({
    entry: "入口",
    nodes: [
      agentNode("入口", promptWithTriggers("你负责入口。", "<continue>"), false),
      spawnNode("辩论", {
        entry: "正方",
        nodes: [
          agentNode("正方", promptWithTriggers("你负责正方。", "<continue>"), false),
          agentNode("反方", promptWithTriggers("你负责反方。", "<complete>"), false),
          {
            ...agentNode("总结", "你负责总结。", false),
            initialMessage: ["正方", "入口"],
          },
        ],
        links: [
          link("正方", "反方", "<continue>", "last"),
          link("反方", "总结", "<complete>", "last"),
          link("总结", "入口", "<default>", "none"),
        ],
      }),
    ],
    links: [
      link("入口", "辩论", "<continue>", "last"),
    ],
  });

  assert.deepEqual(
    compiled.topology.nodeRecords.find((node) => node.id === "总结")?.initialMessageRouting,
    {
      mode: "list",
      agentIds: ["入口", "正方"],
    },
  );
});

test("compileTeamDsl 会拒绝在 link 上声明 initialMessage", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "A",
        nodes: [
          agentNode("A", promptWithTriggers("你负责 A。", "<complete>"), false),
          agentNode("B", "你负责 B。", false),
        ],
        links: [
          {
            from: "A",
            to: "B",
            trigger: "<complete>",
            message_type: "last",
            initialMessage: ["A"],
          },
        ],
      }),
    /只允许显式写出 from、to、trigger、message_type、maxTriggerRounds/u,
  );
});

test("compileTeamDsl 会拒绝非法 maxTriggerRounds，而不是偷偷取整或补底", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "线索发现",
        nodes: [
          agentNode("线索发现", promptWithTriggers("你负责线索发现。", "<continue>"), false),
          agentNode("疑点辩论", "你负责辩论。", false),
        ],
        links: [
          link("线索发现", "疑点辩论", "<continue>", "last", 0),
        ],
      }),
    /maxTriggerRounds 必须是大于等于 1 的整数/u,
  );
});

test("compileTeamDsl 会拒绝空白包裹的 <default> 搭配 maxTriggerRounds", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Judge",
        nodes: [
          agentNode("Judge", "你负责普通流转。", false),
          agentNode("Build", "", true),
        ],
        links: [
          {
            from: "Judge",
            to: "Build",
            trigger: " <default> ",
            message_type: "last",
            maxTriggerRounds: 3,
          },
        ],
      }),
    /只有 action-required trigger 才允许声明 maxTriggerRounds/u,
  );
});

test("compileTeamDsl 会拒绝同一 source 把同一个 trigger 同时用于 labeled 和 action_required", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Judge",
        nodes: [
          agentNode("Judge", promptWithTriggers("你负责判定。", "<same>"), false),
          agentNode("Build", "", true),
          agentNode("Summary", "你负责总结。", false),
        ],
        links: [
          link("Judge", "Build", "<same>", "last", 2),
          link("Judge", "Summary", "<same>", "last"),
        ],
      }),
    /同一 source 不允许把同一个 trigger 同时用于 action_required 和 labeled/u,
  );
});

test("compileTeamDsl 会拒绝 source system_prompt 未显式声明自定义 outgoing trigger", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "Judge",
        nodes: [
          agentNode("Judge", "你负责判定。", false),
          agentNode("Build", "", true),
        ],
        links: [
          link("Judge", "Build", "<revise>", "last"),
        ],
      }),
    /Judge 的 system_prompt 必须显式包含以下 trigger：<revise>/u,
  );
});

test("compileTeamDsl 会拒绝 spawn 子图 agent 未在 system_prompt 里声明回到外层的 trigger", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "线索发现",
        nodes: [
          agentNode("线索发现", "你负责线索发现。", false),
          spawnNode(
            "疑点辩论",
            {
              entry: "讨论总结",
              nodes: [
                agentNode("讨论总结", "你负责讨论总结。", true),
              ],
              links: [
                link("讨论总结", "线索发现", "<continue>", "none"),
              ],
            },
          ),
        ],
        links: [
          link("线索发现", "疑点辩论", "<default>", "last"),
        ],
      }),
    /讨论总结 的 system_prompt 必须显式包含以下 trigger：<continue>/u,
  );
});

test("compileTeamDsl 会拒绝根图 agent 未在 system_prompt 里声明指向 __end__ 的自定义 trigger", () => {
  assert.throws(
    () =>
      compileTeamDsl({
        entry: "漏洞论证",
        nodes: [
          agentNode("漏洞论证", "你负责漏洞论证。", false),
        ],
        links: [
          endLink("漏洞论证", "<done>", "none"),
        ],
      }),
    /漏洞论证 的 system_prompt 必须显式包含以下 trigger：<done>/u,
  );
});

test("matchesAppliedTeamDsl 会把完全一致的当前团队配置识别为无需重复 apply", () => {
  const compiled = compileTeamDsl(createDevelopmentGraphDsl());

  assert.equal(
    matchesAppliedTeamDsl(
      [
        { id: "BA", prompt: BA_PROMPT, isWritable: false },
        { id: "Build", prompt: "", isWritable: true },
        { id: "CodeReview", prompt: CODE_DECISION_PROMPT, isWritable: false },
        { id: "UnitTest", prompt: UNIT_TEST_PROMPT, isWritable: false },
        { id: "TaskReview", prompt: TASK_DECISION_PROMPT, isWritable: false },
      ],
      compiled.topology,
      compiled,
    ),
    true,
  );
});

test("matchesAppliedTeamDslAgents 会把 agent 一致但拓扑不同识别为只需同步 topology", () => {
  const compiled = compileTeamDsl(createDevelopmentGraphDsl());

  assert.equal(
    matchesAppliedTeamDslAgents(
      [
        { id: "BA", prompt: BA_PROMPT, isWritable: false },
        { id: "Build", prompt: "", isWritable: true },
        { id: "CodeReview", prompt: CODE_DECISION_PROMPT, isWritable: false },
        { id: "UnitTest", prompt: UNIT_TEST_PROMPT, isWritable: false },
        { id: "TaskReview", prompt: TASK_DECISION_PROMPT, isWritable: false },
      ],
      compiled,
    ),
    true,
  );
  assert.equal(
    matchesAppliedTeamDslTopology(
      {
        nodes: ["Build", "BA", "CodeReview", "UnitTest", "TaskReview"],
        edges: [{ source: "Build", target: "BA", trigger: "<default>", messageMode: "last" }],
        nodeRecords: buildTopologyNodeRecords({
          nodes: ["Build", "BA", "CodeReview", "UnitTest", "TaskReview"],
          spawnNodeIds: new Set(),
          templateNameByNodeId: new Map(),
          initialMessageRoutingByNodeId: new Map(),
          spawnRuleIdByNodeId: new Map(),
          spawnEnabledNodeIds: new Set(),
          promptByNodeId: new Map(),
          writableNodeIds: new Set(),
        }),
      },
      compiled,
    ),
    false,
  );
});
