import { resolveBuildAgentName } from "./types";

export type TaskSubmissionResolution =
  | {
      ok: true;
      targetAgent: string;
    }
  | {
      ok: false;
      code: "missing_agents" | "missing_build_agent" | "missing_target_agent";
      message: string;
    };

export function resolveTaskSubmissionTarget(input: {
  content: string;
  mentionAgent?: string;
  availableAgents: string[];
}): TaskSubmissionResolution {
  const explicitMention = normalizeAgentName(input.mentionAgent) ?? extractMention(input.content);
  if (explicitMention) {
    if (input.availableAgents.includes(explicitMention)) {
      return {
        ok: true,
        targetAgent: explicitMention,
      };
    }

    return {
      ok: false,
      code: "missing_target_agent",
      message:
        explicitMention.toLowerCase() === "build"
          ? "当前 Project 尚未写入 Build Agent，@Build 不可用。"
          : `未找到被 @ 的 Agent：${explicitMention}`,
    };
  }

  const defaultBuildAgent = resolveBuildAgentName(input.availableAgents);
  if (defaultBuildAgent) {
    return {
      ok: true,
      targetAgent: defaultBuildAgent,
    };
  }

  if (input.availableAgents.length === 0) {
    return {
      ok: false,
      code: "missing_agents",
      message: "当前 Project 还没有可用 Agent，请先配置团队成员。",
    };
  }

  return {
    ok: false,
    code: "missing_build_agent",
    message: "当前 Project 缺少 Build Agent，请使用 @ 指定一个已写入 Agent 后再发送。",
  };
}

function extractMention(content: string): string | undefined {
  const match = content.match(/@([^\s]+)/u);
  return normalizeAgentName(match?.[1]);
}

function normalizeAgentName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
