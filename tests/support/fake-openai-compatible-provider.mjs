import http from "node:http";

const DEFAULT_API_KEY = "careeradapt-test-provider-key";

export async function startFakeOpenAiProvider(options = {}) {
  const apiKey = options.apiKey || DEFAULT_API_KEY;
  const mode = options.mode || "smoke";
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${apiKey}`) {
      writeJson(response, 401, { error: { message: "Invalid fake provider key", type: "invalid_request_error", code: "invalid_api_key" } });
      return;
    }
    if (request.method === "GET" && pathname === "/v1/models") {
      writeJson(response, 200, { object: "list", data: [{ id: "careeradapt-test", object: "model", owned_by: "careeradapt" }] });
      return;
    }
    if (request.method !== "POST" || pathname !== "/v1/chat/completions") {
      writeJson(response, 404, { error: { message: "fake provider route not found", code: "not_found" } });
      return;
    }
    const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    const requestRecord = {
      authorization,
      messages,
      toolNames: tools.flatMap((tool) => {
        const record = tool && typeof tool === "object" ? tool : {};
        const fn = record.function && typeof record.function === "object" ? record.function : {};
        return typeof fn.name === "string" ? [fn.name] : [];
      }),
      stream: payload.stream === true
    };
    requests.push(requestRecord);
    const responseMessage = chooseResponse({ mode, messages, tools });
    const responseId = `fake-chat-${requests.length}`;
    if (payload.stream === true) {
      writeStream(response, responseMessage, responseId);
      return;
    }
    writeJson(response, 200, completionPayload(responseMessage, responseId));
  });
  await listen(server);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  if (!port) throw new Error("fake provider did not expose a port");
  return {
    apiKey,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined)))
  };
}

function chooseResponse({ mode, messages, tools }) {
  const lastToolResult = [...messages].reverse().find((message) => message && message.role === "tool");
  if (lastToolResult) {
    const name = typeof lastToolResult.name === "string" ? lastToolResult.name : "CareerAdapt tool";
    if (name.includes("profile_intake_turn")) return { content: "已进入 Profile Intake，并停在下一步资料补充边界。" };
    if (name.includes("profile_intake_finalize")) return { content: "Profile Intake 已整理为待用户复核的草稿。" };
    if (name.includes("job_fit")) return { content: "已完成岗位匹配比较，并保留证据缺口。" };
    if (name.includes("compose_resume")) return { content: "已完成通用简历检查，并停在用户确认边界。" };
    if (name.includes("profile")) return { content: "当前示例资料包含 2 个项目经历。" };
    if (name.includes("tailor_resume")) return { content: "已读取当前示例岗位，并停在用户确认边界。" };
    if (name.includes("resume_export")) return { content: "已准备简历导出产物。" };
    return { content: "CareerAdapt 工具已返回结果。" };
  }
  if (mode === "integration") {
    const userText = latestUserText(messages);
    if (/从零|没有简历|开始帮我做/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.profile_intake_turn");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ userTurn: userText }) } };
    }
    if (/根据.*JD.*生成.*岗位简历/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.tailor_resume");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ targetText: "数据分析实习生，负责数据清洗、分析与报告，要求 Python 和 SQL 能力。" }) } };
    }
    if (/匹配/u.test(userText) && /岗位/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.job_fit");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ profileId: "profile-demo-student", resumeId: "resume-general-1", jobId: "job-data-analyst-intern" }) } };
    }
    if (/看看.*简历|优化.*通用|这份简历.*问题/u.test(userText) && !/岗位|JD/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.compose_resume");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ mode: "general", profileId: "profile-demo-student", expectedProfileRevision: 1, sourceResumeId: "resume-general-1", generalResumeMode: "update_existing" }) } };
    }
    if (/导出.*简历|导出这份简历/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.resume_export");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ resumeId: "resume-general-1" }) } };
    }
    if (/资料|个人资料|姓名|项目经历|经历|适合哪些岗位|profile/u.test(userText)) {
      const toolName = findToolName(tools, "career.profile.get");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ profileId: "profile-demo-student" }) } };
    }
    if (/岗位|定制|简历投|tailor/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.tailor_resume");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ jobId: "job-data-analyst-intern" }) } };
    }
  }
  return { content: "你好，Hermes hermetic runtime 已就绪。" };
}

function latestUserText(messages) {
  const message = [...messages].reverse().find((entry) => entry && entry.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    return typeof part.text === "string" ? [part.text] : [];
  }).join("\n");
}

function findToolName(tools, stableName) {
  const normalized = stableName.replace(/[^A-Za-z0-9_]/gu, "_");
  return tools.flatMap((tool) => {
    const record = tool && typeof tool === "object" ? tool : {};
    const fn = record.function && typeof record.function === "object" ? record.function : {};
    return typeof fn.name === "string" && (fn.name === stableName || fn.name.endsWith(`__${normalized}`) || fn.name.endsWith(`_${normalized}`))
      ? [fn.name]
      : [];
  })[0];
}

function completionPayload(message, id) {
  const choice = message.toolCall
    ? {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `${id}-tool`, type: "function", function: { name: message.toolCall.name, arguments: message.toolCall.arguments } }]
        },
        finish_reason: "tool_calls"
      }
    : { index: 0, message: { role: "assistant", content: message.content }, finish_reason: "stop" };
  return { id, object: "chat.completion", choices: [choice], model: "careeradapt-test", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}

function writeStream(response, message, id) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const payload = completionPayload(message, id);
  const choice = payload.choices[0];
  if (message.toolCall) {
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: choice.message.tool_calls }, finish_reason: "tool_calls" }] })}\n\n`);
  } else {
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: message.content }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) : undefined);
    });
    request.on("error", reject);
  });
}

function writeJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}
