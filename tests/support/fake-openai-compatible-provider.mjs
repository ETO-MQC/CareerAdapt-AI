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
  if (mode === "career-agent-eval") {
    return chooseCareerAgentEvalResponse({ messages, tools, lastToolResult });
  }
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

function chooseCareerAgentEvalResponse({ messages, tools, lastToolResult }) {
  const userText = latestUserText(messages);
  const userMessages = messages.filter((message) => message && message.role === "user");
  const lastMessage = messages.at(-1);

  if (tools.length === 0) {
    const systemText = messageText(messages.find((message) => message && message.role === "system")?.content);
    const structuredInput = parseJsonText(userText);
    if (/extract every supported career asset/u.test(systemText)) {
      return { content: JSON.stringify(profileIntakeSemanticResponse(structuredInput)) };
    }
    if (/answer one targeted follow-up question/u.test(systemText)) {
      return { content: JSON.stringify({
        candidateId: structuredInput?.candidateId || "intake-candidate",
        patch: {},
        evidenceQuote: structuredInput?.currentUserAnswer || "不确定",
        answeredDimension: structuredInput?.expectedDimension || "result",
        confidence: 0.4
      }) };
    }
    if (/final provisional interview draft/u.test(systemText)) {
      return { content: JSON.stringify({
        assets: Array.isArray(structuredInput?.assets) ? structuredInput.assets.map((asset) => ({
          candidateId: asset.candidateId,
          structuredItem: asset.structuredItem,
          careerReadySummary: asset.sourceQuote || "已确认的职业经历",
          careerReadyHighlights: [],
          missingDimensions: asset.missingDimensions || [],
          conflicts: asset.conflicts || []
        })) : []
      }) };
    }
  }

  // A new user turn after the first Profile Intake response consumes the
  // current answer through the same high-level facade.  The final tool result
  // is handled below once the bridge returns it.
  if (lastToolResult?.name?.includes("profile_intake_turn")
    && lastMessage?.role === "user"
    && userMessages.length > 1) {
    const toolName = findToolName(tools, "career.workflow.profile_intake_turn");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ userTurn: userText }) } };
  }

  if (lastToolResult) {
    const name = typeof lastToolResult.name === "string" ? lastToolResult.name : "";
    if (name.includes("profile_intake_turn")) {
      if (/不知道/u.test(userText)) return { content: "已保留你的不确定性，不会补写未经确认的事实，并继续下一项确认。" };
      if (/跳过/u.test(userText)) return { content: "已记录本题跳过，继续下一项，不会立即重复询问刚才的问题。" };
      return { content: "已记录这次回答，并继续到下一项资料确认。" };
    }
    if (name.includes("job_fit")) {
      if (/Tableau/u.test(userText)) return { content: "已完成岗位匹配比较：Tableau 是当前可见缺口，不会当作你的候选人证据。" };
      return { content: "已完成岗位匹配比较，并保留证据缺口。" };
    }
    if (name.includes("compose_resume")) return { content: "已准备通用简历提案，并停在用户确认边界。" };
    if (name.includes("tailor_resume")) return { content: "已准备岗位简历提案，并停在用户确认边界。" };
    if (name.includes("resume_export")) return { content: "已读取持久化简历版本，并准备 PDF 导出产物。" };
    if (name.includes("resume_list")) return { content: "当前有多份简历，请先选择要导出的那一份。" };
    if (name.includes("profile")) {
      if (/英语|英文/u.test(userText)) return { content: "资料中有 CET-4 成绩 601；除此之外没有足够证据评价更高阶英语能力。" };
      return { content: "当前示例资料包含 2 个项目经历。" };
    }
  }

  if (/^你好[！!。.]?$/u.test(userText)) return { content: "你好！我可以陪你整理职业资料、分析岗位匹配度、制作和导出简历。" };
  if (/你会干什么/u.test(userText)) return { content: "我可以做普通对话，也可以在你明确需要时读取职业资料、分析岗位、准备简历和导出 PDF。" };
  if (/大学生找工作应该怎么准备/u.test(userText)) return { content: "可以从目标方向、可证明的经历、简历版本和面试复盘四步准备；先选一个目标岗位，再把经历整理成可核验的行动与结果。" };
  if (/给我讲个笑话/u.test(userText)) return { content: "程序员去相亲，介绍自己时说：我最大的优点是稳定，最大的缺点是偶尔需要重启。" };

  if (lastToolResult?.name?.includes("profile_intake_turn")) {
    const toolName = findToolName(tools, "career.workflow.profile_intake_turn");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ userTurn: userText }) } };
  }
  if (/我目前有几个项目经历|根据我的经历，我比较适合什么岗位|我英语怎么样/u.test(userText)) {
    const toolName = findToolName(tools, "career.profile.get");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ profileId: "profile-demo-student" }) } };
  }
  if (/没有任何资料，从零开始|没有简历，从零开始|从零开始帮我整理/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.profile_intake_turn");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ userTurn: userText }) } };
  }
  if (/根据我的资料生成一份通用简历|资料还不完整.*通用简历|已有通用简历.*更新/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.compose_resume");
    if (toolName) {
      const updateExisting = /已有通用简历/u.test(userText);
      return {
        toolCall: {
          name: toolName,
          arguments: JSON.stringify({
            mode: "general",
            profileId: "profile-demo-student",
            expectedProfileRevision: 1,
            ...(updateExisting ? { sourceResumeId: "resume-general-1", generalResumeMode: "update_existing" } : { generalResumeMode: "create_new" })
          })
        }
      };
    }
  }
  if (/看看我的通用简历有什么问题|优化一下我的通用简历|只告诉我问题，不要修改/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.compose_resume");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ mode: "general", profileId: "profile-demo-student", expectedProfileRevision: 1, sourceResumeId: "resume-general-1", generalResumeMode: "update_existing" }) } };
  }
  if (/定制岗位简历/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.tailor_resume");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ targetText: "数据分析实习生，要求 Python 和 SQL；未确认的工具不进入候选人事实。" }) } };
  }
  if (/分析一下我和这个岗位|分析一下这个岗位|匹配度|这个岗位要求 Tableau|Stata.*岗位/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.job_fit");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ profileId: "profile-demo-student", resumeId: "resume-general-1", jobId: "job-data-analyst-intern" }) } };
  }
  if (/岗位简历|岗位 JD|定制岗位简历/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.tailor_resume");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ targetText: /Tableau/u.test(userText) ? "数据分析实习生，要求 Python 和 SQL；未确认的工具不进入候选人事实。" : "数据分析实习生，负责数据清洗、统计分析和周报支持，要求 Python 和 SQL。" }) } };
  }
  if (/把简历导出PDF/u.test(userText) && !/这份/u.test(userText)) {
    const toolName = findToolName(tools, "career.resume.list");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({}) } };
  }
  if (/把这份简历导出PDF|把这份简历导出 PDF/u.test(userText)) {
    const toolName = findToolName(tools, "career.workflow.resume_export");
    if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ resumeId: "resume-general-1" }) } };
  }
  return { content: "我理解了你的请求，会先保留已确认的信息，并在需要时说明下一步。" };
}

function profileIntakeSemanticResponse(input) {
  const rawNarrative = typeof input?.rawNarrative === "string" ? input.rawNarrative : "";
  if (!/校园项目|Excel|数据整理|数据展示/u.test(rawNarrative)) {
    return { candidates: [], followUpQuestions: ["请先说一段你实际参与过的学习、项目或工作经历。"] };
  }
  return {
    candidates: [{
      candidateKey: "campus-data-project",
      sectionType: "project",
      sourceBlockIds: ["source-block-1"],
      sourceQuote: rawNarrative,
      structuredItem: {
        sectionType: "project",
        title: "校园项目",
        tools: ["Excel"],
        description: "做过数据整理和展示",
        highlights: [],
        outcomes: [],
        current: false
      },
      professionalText: "在校园项目中使用 Excel 做过数据整理和展示。",
      uncertainFields: []
    }],
    followUpQuestions: ["这个项目最终形成了什么结果，或解决了什么问题？"]
  };
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => part && typeof part === "object" && typeof part.text === "string" ? [part.text] : []).join("\n");
}

function parseJsonText(text) {
  if (typeof text !== "string") return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
