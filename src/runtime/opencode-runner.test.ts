import test from "node:test";
import assert from "node:assert/strict";

import { OpenCodeRunner } from "./opencode-runner";

for (const scenario of [
  {
    errorMessage: "terminated",
    timestamp: "2026-04-17T06:17:06.782Z",
    completedAt: "2026-04-17T06:17:06.782Z",
    messageTimestamp: "2026-04-17T06:16:08.105Z",
  },
  {
    errorMessage: "fetch failed",
    timestamp: "2026-04-27T03:49:02.477Z",
    completedAt: "2026-04-27T03:49:02.477Z",
    messageTimestamp: "2026-04-27T03:48:31.000Z",
  },
]) {
  test(`submitMessage 返回 ${scenario.errorMessage} 后，若同一 session 稍后补出正式回复，runner 应恢复该结果`, async () => {
    const expectedResult = {
      status: "completed" as const,
      finalMessage: "补回来的正式回复",
      messageId: "msg-final",
      timestamp: scenario.timestamp,
      rawMessage: {
        id: "msg-final",
        content: "补回来的正式回复",
        sender: "assistant",
        timestamp: scenario.messageTimestamp,
        completedAt: scenario.completedAt,
        error: null,
        raw: null,
      },
    };

    const client = {
      submitMessage: async () => {
        throw new Error(scenario.errorMessage);
      },
      resolveExecutionResult: async () => {
        throw new Error("不应该走到 resolveExecutionResult");
      },
      recoverExecutionResultAfterTransportError: async (
        projectPath: string,
        sessionId: string,
        startedAt: string,
        errorMessage: string,
      ) => {
        assert.equal(projectPath, "/tmp/project");
        assert.equal(sessionId, "session-1");
        assert.match(startedAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.equal(errorMessage, scenario.errorMessage);
        return expectedResult;
      },
    };

    const runner = new OpenCodeRunner(client as never);
    const result = await runner.run({
      projectPath: "/tmp/project",
      sessionId: "session-1",
      content: "给出 poc",
      agent: "安全负责人",
    });

    assert.deepEqual(result, expectedResult);
  });
}

test("submitMessage 连续失败两次时，runner 会重试两次并返回第三次成功结果", async () => {
  let submitCount = 0;
  let recoverCount = 0;
  const client = {
    submitMessage: async () => {
      submitCount += 1;
      if (submitCount <= 2) {
        throw new Error("temporary upstream failure");
      }
      return {
        id: "msg-submitted",
        content: "",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:00.000Z",
        completedAt: null,
        error: null,
        raw: null,
      };
    },
    resolveExecutionResult: async () => ({
      status: "completed" as const,
      finalMessage: "第二次提交成功",
      messageId: "msg-final",
      timestamp: "2026-05-07T10:00:02.000Z",
      rawMessage: {
        id: "msg-final",
        content: "第二次提交成功",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:02.000Z",
        completedAt: "2026-05-07T10:00:02.000Z",
        error: null,
        raw: null,
      },
    }),
    recoverExecutionResultAfterTransportError: async (
      projectPath: string,
      sessionId: string,
      startedAt: string,
      errorMessage: string,
    ) => {
      recoverCount += 1;
      assert.equal(projectPath, "/tmp/project");
      assert.equal(sessionId, "session-1");
      assert.match(startedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(errorMessage, "temporary upstream failure");
      return null;
    },
  };

  const runner = new OpenCodeRunner(client as never);
  const result = await runner.run({
    projectPath: "/tmp/project",
    sessionId: "session-1",
    content: "继续执行",
    agent: "漏洞论证-4",
  });

  assert.equal(submitCount, 3);
  assert.equal(recoverCount, 2);
  assert.equal(result.finalMessage, "第二次提交成功");
});

test("recovery 连续抛错两次时，runner 会继续重试直到第三次成功", async () => {
  let submitCount = 0;
  let recoverCount = 0;
  const client = {
    submitMessage: async () => {
      submitCount += 1;
      if (submitCount <= 2) {
        throw new Error("temporary upstream failure");
      }
      return {
        id: "msg-submitted",
        content: "",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:00.000Z",
        completedAt: null,
        error: null,
        raw: null,
      };
    },
    resolveExecutionResult: async () => ({
      status: "completed" as const,
      finalMessage: "第三次尝试成功",
      messageId: "msg-final",
      timestamp: "2026-05-07T10:00:02.000Z",
      rawMessage: {
        id: "msg-final",
        content: "第三次尝试成功",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:02.000Z",
        completedAt: "2026-05-07T10:00:02.000Z",
        error: null,
        raw: null,
      },
    }),
    recoverExecutionResultAfterTransportError: async () => {
      recoverCount += 1;
      throw new Error(`recovery failure ${recoverCount}`);
    },
  };

  const runner = new OpenCodeRunner(client as never);
  const result = await runner.run({
    projectPath: "/tmp/project",
    sessionId: "session-1",
    content: "继续执行",
    agent: "漏洞论证-4",
  });

  assert.equal(submitCount, 3);
  assert.equal(recoverCount, 2);
  assert.equal(result.finalMessage, "第三次尝试成功");
});

test("resolveExecutionResult 连续返回两次 error 结果时，runner 会重试两次", async () => {
  let submitCount = 0;
  let resolveCount = 0;
  let recoverCount = 0;
  const client = {
    submitMessage: async () => {
      submitCount += 1;
      return {
        id: `msg-submitted-${submitCount}`,
        content: "",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:00.000Z",
        completedAt: null,
        error: null,
        raw: null,
      };
    },
    resolveExecutionResult: async () => {
      resolveCount += 1;
      if (resolveCount <= 2) {
        return {
          status: "error" as const,
          finalMessage: "temporary upstream failure",
          messageId: "msg-error",
          timestamp: "2026-05-07T10:00:01.000Z",
          rawMessage: {
            id: "msg-error",
            content: "",
            sender: "assistant",
            timestamp: "2026-05-07T10:00:01.000Z",
            completedAt: "2026-05-07T10:00:01.000Z",
            error: "temporary upstream failure",
            raw: null,
          },
        };
      }
      return {
        status: "completed" as const,
        finalMessage: "重试后恢复成功",
        messageId: "msg-final",
        timestamp: "2026-05-07T10:00:03.000Z",
        rawMessage: {
          id: "msg-final",
          content: "重试后恢复成功",
          sender: "assistant",
          timestamp: "2026-05-07T10:00:03.000Z",
          completedAt: "2026-05-07T10:00:03.000Z",
          error: null,
          raw: null,
        },
      };
    },
    recoverExecutionResultAfterTransportError: async (
      projectPath: string,
      sessionId: string,
      startedAt: string,
      errorMessage: string,
    ) => {
      recoverCount += 1;
      assert.equal(projectPath, "/tmp/project");
      assert.equal(sessionId, "session-1");
      assert.match(startedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(errorMessage, "temporary upstream failure");
      return null;
    },
  };

  const runner = new OpenCodeRunner(client as never);
  const result = await runner.run({
    projectPath: "/tmp/project",
    sessionId: "session-1",
    content: "继续执行",
    agent: "漏洞论证-4",
  });

  assert.equal(submitCount, 3);
  assert.equal(resolveCount, 3);
  assert.equal(recoverCount, 2);
  assert.equal(result.finalMessage, "重试后恢复成功");
});

test("重试两次后仍然返回 error 结果时，会在第三次停止并返回 error 结果", async () => {
  let submitCount = 0;
  const client = {
    submitMessage: async () => {
      submitCount += 1;
      return {
        id: `msg-submitted-${submitCount}`,
        content: "",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:00.000Z",
        completedAt: null,
        error: null,
        raw: null,
      };
    },
    resolveExecutionResult: async () => ({
      status: "error" as const,
      finalMessage: "temporary upstream failure",
      messageId: `msg-error-${submitCount}`,
      timestamp: "2026-05-07T10:00:01.000Z",
      rawMessage: {
        id: `msg-error-${submitCount}`,
        content: "",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:01.000Z",
        completedAt: "2026-05-07T10:00:01.000Z",
        error: "temporary upstream failure",
        raw: null,
      },
    }),
    recoverExecutionResultAfterTransportError: async () => null,
  };

  const runner = new OpenCodeRunner(client as never);
  const result = await runner.run({
    projectPath: "/tmp/project",
    sessionId: "session-1",
    content: "继续执行",
    agent: "漏洞论证-4",
  });

  assert.equal(submitCount, 3);
  assert.equal(result.status, "error");
});

test("recovery 连续返回两次 error 结果时，runner 会继续重试直到第三次 recovery 成功", async () => {
  let submitCount = 0;
  let recoverCount = 0;
  const client = {
    submitMessage: async () => {
      submitCount += 1;
      throw new Error("fetch failed");
    },
    resolveExecutionResult: async () => {
      throw new Error("不应该走到 resolveExecutionResult");
    },
    recoverExecutionResultAfterTransportError: async () => {
      recoverCount += 1;
      if (recoverCount <= 2) {
        return {
          status: "error" as const,
          finalMessage: `recovered error ${recoverCount}`,
          messageId: `msg-error-${recoverCount}`,
          timestamp: "2026-05-07T10:00:01.000Z",
          rawMessage: {
            id: `msg-error-${recoverCount}`,
            content: "",
            sender: "assistant",
            timestamp: "2026-05-07T10:00:01.000Z",
            completedAt: "2026-05-07T10:00:01.000Z",
            error: `recovered error ${recoverCount}`,
            raw: null,
          },
        };
      }
      return {
        status: "completed" as const,
        finalMessage: "第三次 recovery 成功",
        messageId: "msg-final",
        timestamp: "2026-05-07T10:00:03.000Z",
        rawMessage: {
          id: "msg-final",
          content: "第三次 recovery 成功",
          sender: "assistant",
          timestamp: "2026-05-07T10:00:03.000Z",
          completedAt: "2026-05-07T10:00:03.000Z",
          error: null,
          raw: null,
        },
      };
    },
  };

  const runner = new OpenCodeRunner(client as never);
  const result = await runner.run({
    projectPath: "/tmp/project",
    sessionId: "session-1",
    content: "继续执行",
    agent: "漏洞论证-4",
  });

  assert.equal(submitCount, 3);
  assert.equal(recoverCount, 3);
  assert.equal(result.status, "completed");
  assert.equal(result.finalMessage, "第三次 recovery 成功");
});

test("正常完成的回复不应触发重试", async () => {
  let submitCount = 0;
  let recoverCount = 0;
  const client = {
    submitMessage: async () => {
      submitCount += 1;
      return {
        id: "msg-submitted",
        content: "",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:00.000Z",
        completedAt: null,
        error: null,
        raw: null,
      };
    },
    resolveExecutionResult: async () => ({
      status: "completed" as const,
      finalMessage: "分析结论：本次已正常完成",
      messageId: "msg-final",
      timestamp: "2026-05-07T10:00:02.000Z",
      rawMessage: {
        id: "msg-final",
        content: "分析结论：本次已正常完成",
        sender: "assistant",
        timestamp: "2026-05-07T10:00:02.000Z",
        completedAt: "2026-05-07T10:00:02.000Z",
        error: null,
        raw: null,
      },
    }),
    recoverExecutionResultAfterTransportError: async () => {
      recoverCount += 1;
      return null;
    },
  };

  const runner = new OpenCodeRunner(client as never);
  const result = await runner.run({
    projectPath: "/tmp/project",
    sessionId: "session-1",
    content: "继续执行",
    agent: "漏洞论证-4",
  });

  assert.equal(submitCount, 1);
  assert.equal(recoverCount, 0);
  assert.equal(result.status, "completed");
});
