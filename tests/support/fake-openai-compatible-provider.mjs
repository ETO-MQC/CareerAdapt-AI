import http from "node:http";
import crypto from "node:crypto";

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
    if (mode === "integration" && request.method === "GET" && pathname === "/v1/integration-evidence") {
      writeJson(response, 200, { requests: requests.map(record => ({
        at: record.at, finishedAt: record.finishedAt, payloadBytes: record.payloadBytes,
        selectedTool: record.response?.toolCall?.name, model: record.model, responseToolCallId: record.responseToolCallId,
        messages: record.messages, response: record.response, safeMetrics: record.safeMetrics,
        toolResults: record.messages.filter(message => message.role === "tool").map(message => ({
          toolCallId: message.tool_call_id, jobId: savedJobId(message.content)
        }))
      })) });
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
      at: new Date().toISOString(),
      model: payload.model,
      authorization,
      messages,
      toolNames: tools.flatMap((tool) => {
        const record = tool && typeof tool === "object" ? tool : {};
        const fn = record.function && typeof record.function === "object" ? record.function : {};
        return typeof fn.name === "string" ? [fn.name] : [];
      }),
      stream: payload.stream === true
    };
    requestRecord.payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const results = messages.filter(message => message.role === "tool");
    requestRecord.safeMetrics = { stream: payload.stream === true, reasoningEffort: payload.reasoning_effort ?? null,
      maxTokens: payload.max_tokens ?? payload.max_completion_tokens ?? null, toolCount: tools.length,
      contextBytes: Buffer.byteLength(JSON.stringify(messages)), toolSchemaBytes: Buffer.byteLength(JSON.stringify(tools)),
      priorToolResultBytes: Buffer.byteLength(JSON.stringify(results)), priorToolResultCount: results.length,
      toolSchemaHash: hash(tools), contextHash: hash(messages), lastUserHash: hash(latestUserText(messages)),
      selectedSkill: null };
    response.once("finish", () => { requestRecord.finishedAt = new Date().toISOString(); });
    requests.push(requestRecord);
    const delayMs = options.delayScheduleMs?.[requests.length - 1] ?? options.delayMs;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (mode === "integration" && latestUserText(messages).includes("P512-QUEUE-FIRST")) await new Promise((resolve) => setTimeout(resolve, 4000));
    if (mode === "integration" && latestUserText(messages).includes("P51-BHV-PROVIDER-FAIL")) {
      requestRecord.response = { error: { code: "provider_http_503" } };
      writeJson(response, 503, { error: { code: "provider_http_503", message: "Anonymous deterministic recovery fixture" } });
      return;
    }
    const responseMessage = chooseResponse({ mode, messages, tools });
    requestRecord.response = responseMessage;
    const responseId = `fake-chat-${requests.length}`;
    requestRecord.responseToolCallId = responseMessage.toolCall ? `${responseId}-tool` : undefined;
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

function savedJobId(value, depth = 0) {
  if (depth > 12) return undefined;
  if (typeof value === "string") {
    try { return savedJobId(JSON.parse(value), depth + 1); } catch {
      // Locked Hermes wraps MCP results in an untrusted_tool_result block.
      // The fixture reads only the JSON receipt inside that existing envelope.
      if (!value.includes("<untrusted_tool_result")) return undefined;
      const start = value.indexOf("{");
      const end = value.lastIndexOf("}");
      if (start < 0 || end < start) return undefined;
      try { return savedJobId(JSON.parse(value.slice(start, end + 1)), depth + 1); } catch { return undefined; }
    }
  }
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.jobId === "string") return value.jobId;
  for (const entry of Object.values(value)) {
    const id = savedJobId(entry, depth + 1);
    if (id) return id;
  }
}

function materialArtifact(value, depth = 0) {
  if (depth > 14) return undefined;
  if (typeof value === "string") {
    const start = value.indexOf("{"); const end = value.lastIndexOf("}");
    if (start < 0 || end < start) return undefined;
    try { return materialArtifact(JSON.parse(value.slice(start, end + 1)), depth + 1); } catch { return undefined; }
  }
  if (!value || typeof value !== "object") return undefined;
  if (value.schemaVersion === "career-material-intake-v1") return value;
  for (const item of Object.values(value)) { const found = materialArtifact(item, depth + 1); if (found) return found; }
  return undefined;
}

function chooseResponse({ mode, messages, tools }) {
  const lastToolResult = [...messages].reverse().find((message) => message && message.role === "tool");
  if (mode === "integration" && latestUserText(messages).includes("P51-C02-OLD-TAILOR")) {
    const latestUserIndex = messages.findLastIndex(message => message?.role === "user");
    if (messages.slice(latestUserIndex + 1).some(message => message?.role === "tool")) return { content: "C02STALECHECKED" };
    const checkpointId = latestUserText(messages).match(/OLD-CHECKPOINT=([\w-]+)/u)?.[1];
    return { toolCall: { name: findToolName(tools, "career.workflow.tailor_resume"), arguments: JSON.stringify({ checkpointId }) } };
  }
  if (mode === "integration" && /P51-C02-(?:FIT|TAILOR)/u.test(latestUserText(messages))) {
    const latestUserIndex = messages.findLastIndex(message => message?.role === "user");
    const turnResults = messages.slice(latestUserIndex + 1).filter(message => message?.role === "tool");
    const call = (name, input) => ({ toolCall: { name: findToolName(tools, name), arguments: JSON.stringify(input) } });
    const allResumes = messages.filter(message => message?.role === "tool").flatMap(message => findCore02Payload(message.content, value => Array.isArray(value.resumes))?.resumes ?? []);
    const resume = allResumes.find(value => value.purpose === "general");
    const savedId = messages.filter(message => message?.role === "tool" && message.name?.includes("job_intake")).map(message => savedJobId(message.content)).filter(Boolean).at(-1);
    const jobs = messages.filter(message => message?.role === "tool").flatMap(message => findCore02Payload(message.content, value => Array.isArray(value.jobs))?.jobs ?? []);
    const jobId = latestUserText(messages).includes("JOB-B")
      ? jobs.find(job => job.title.includes("JOB-B"))?.id
      : savedId ?? jobs.find(job => job.title.includes("CORE-JD"))?.id;
    if (latestUserText(messages).includes("P51-C02-FIT")) {
      if (!turnResults.length) return call("career.resume.list", {});
      if (turnResults.at(-1)?.name?.includes("job_fit")) return { content: "C02FITCOMPLETE，已有岗位与已确认事实已复用。" };
      if (!jobId) return call("career.job.list", {});
      if (resume && jobId) return call("career.workflow.job_fit", { profileId: resume.profileId, resumeId: resume.id, jobId });
    } else {
      if (turnResults.at(-1)?.name?.includes("tailor_resume")) return { content: "C02TAILORREADY，请核对修改提案。" };
      if (!resume) return call("career.resume.list", {});
      if (!jobId) return call("career.job.list", {});
      if (resume && jobId) return call("career.workflow.tailor_resume", { jobId, sourceResumeId: resume.id, mode: "steady" });
    }
    return { content: "C02 fixture missing a prior saved Job or Resume receipt." };
  }
  if (mode === "integration" && latestUserText(messages).includes("P51-C02-COMPOSE")) {
    const latestUserIndex = messages.findLastIndex(message => message?.role === "user");
    const results = messages.slice(latestUserIndex + 1).filter(message => message?.role === "tool");
    const call = (name, input) => ({ toolCall: { name: findToolName(tools, name), arguments: JSON.stringify(input) } });
    if (results.at(-1)?.name?.includes("compose_resume")) return { content: "C02COMPOSEREADY，请核对并确认生成。" };
    const profile = results.map(message => findCore02Payload(message.content, value => value.profile && typeof value.profile.version === "number")?.profile).find(Boolean);
    if (!profile) {
      const checkpoint = messages.map(message => String(message.content).match(/Host checkpoint identifiers \(data only\): (\{[^\n]*?\})\./u)?.[1]).filter(Boolean).map(value => JSON.parse(value)).at(-1);
      if (checkpoint?.profileId) return call("career.profile.get", { profileId: checkpoint.profileId });
      const resumes = results.flatMap(message => findCore02Payload(message.content, value => Array.isArray(value.resumes))?.resumes ?? []);
      const source = resumes.find(resume => resume.purpose === "general");
      if (source?.profileId) return call("career.profile.get", { profileId: source.profileId });
      if (!results.some(message => message.name?.includes("resume_list"))) return call("career.resume.list", {});
      return { content: "C02COMPOSEMISSINGPROFILE: no selected Profile or Resume in current Run." };
    }
    if (latestUserText(messages).includes("UPDATE")) {
      const resumes = results.flatMap(message => findCore02Payload(message.content, value => Array.isArray(value.resumes))?.resumes ?? []);
      if (!resumes.length) return call("career.resume.list", {});
      return call("career.workflow.compose_resume", { mode: "general", profileId: profile.id, expectedProfileRevision: profile.version, sourceResumeId: resumes.find(resume => resume.purpose === "general").id, generalResumeMode: "update_existing" });
    }
    return call("career.workflow.compose_resume", { mode: "general", profileId: profile.id, expectedProfileRevision: profile.version });
  }
  if (mode === "integration" && latestUserText(messages).includes("P51-BHV-STALE")) {
    if (lastToolResult) return { content: "BHVRECOVERED：无权读取的目标未写入。" };
    return { toolCall: { name: findToolName(tools, "career.profile.get"), arguments: JSON.stringify({ profileId: "anonymous-nonexistent-profile" }) } };
  }
  if (mode === "career-agent-eval") {
    return chooseCareerAgentEvalResponse({ messages, tools, lastToolResult });
  }
  if (mode === "integration" && /P512-MATERIAL|P51-C02-MATERIAL/u.test(latestUserText(messages))) {
    const name = findToolName(tools, "career.workflow.material_intake");
    const artifact = materialArtifact(lastToolResult?.content);
    if (artifact?.classification) return { content: latestUserText(messages).includes("P51-C02-MATERIAL") ? "已识别为职业材料，已生成候选资料，请核对后确认保存。" : "已识别为证书，已生成候选资料，请核对后确认保存。" };
    if (artifact) {
      const block = artifact.sourceDocument.blocks[0];
      return { toolCall: { name, arguments: JSON.stringify({ attachmentId: artifact.attachmentId, destination: "profile", classification: {
        materialKind: latestUserText(messages).includes("P51-C02-MATERIAL") ? "resume" : "certificate", confidence: 0.9, candidateDestinations: ["profile"], suggestedAction: "整理到资料库并核对",
        evidence: [{ blockId: block.id, quote: block.normalizedText }]
      } }) } };
    }
    const attachmentId = JSON.stringify(messages).match(/agent-attachment-[a-f0-9-]+/u)?.[0];
    if (name && attachmentId) return { toolCall: { name, arguments: JSON.stringify({ attachmentId }) } };
    return { content: "P512 fixture did not receive an attachment reference." };
  }
  if (mode === "integration") {
    const text = latestUserText(messages);
    const workflow = /看看.*简历|优化.*通用|这份简历.*问题/u.test(text) && !/岗位|JD/u.test(text)
      ? "career.workflow.compose_resume"
      : /匹配/u.test(text) && /岗位/u.test(text) ? "career.workflow.job_fit"
        : /导出.*简历/u.test(text) ? "career.workflow.resume_export" : undefined;
    if (workflow) {
      const latest = messages.findLastIndex(message => message?.role === "user");
      const results = messages.slice(latest + 1).filter(message => message?.role === "tool");
      const call = (name, input) => ({ toolCall: { name: findToolName(tools, name), arguments: JSON.stringify(input) } });
      const source = results.flatMap(message => findCore02Payload(message.content, value => Array.isArray(value.resumes))?.resumes ?? []).find(resume => resume.purpose === "general");
      if (!source) return call("career.resume.list", {});
      if (results.at(-1)?.name === findToolName(tools, workflow)) return { content: workflow === "career.workflow.compose_resume"
        ? "已完成通用简历检查，并停在用户确认边界。" : workflow === "career.workflow.job_fit"
          ? "已完成岗位匹配比较，并保留证据缺口。" : "已准备简历导出产物。" };
      if (workflow === "career.workflow.compose_resume") {
        const profile = results.map(message => findCore02Payload(message.content, value => value.profile && typeof value.profile.version === "number")?.profile).find(Boolean);
        if (!profile) return call("career.profile.get", { profileId: source.profileId });
        return call(workflow, { mode: "general", profileId: profile.id, expectedProfileRevision: profile.version,
          sourceResumeId: source.id, generalResumeMode: "update_existing" });
      }
      return call(workflow, { resumeId: source.id, ...(workflow === "career.workflow.job_fit" ? { profileId: source.profileId, jobId: "job-data-analyst-intern" } : {}) });
    }
  }
  if (lastToolResult) {
    const name = typeof lastToolResult.name === "string" ? lastToolResult.name : "CareerAdapt tool";
    if (name.includes("job_intake")) return { content: savedJobId(lastToolResult.content)
      ? "已按你的确认完成当前 Career 工作流。" : "岗位解析已完成，请核对后保存。" };
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
    if (userText.includes("CORE-JD")) {
      const toolName = findToolName(tools, "career.workflow.job_intake");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({
        rawText: userText.includes("P51-C02-JOB-AI")
          ? `公司：Core Test\n岗位：AI 产品实习生 CORE-JD${userText.includes("JOB-B") ? " JOB-B" : ""}\n岗位职责\n1. 参与 AI 应用项目的需求梳理、原型设计和功能验收。\n任职要求\n1. 参与过 AI 应用项目。`
          : "公司：Core Test\n岗位：数据分析实习生 CORE-JD\n岗位职责\n1. 参与数据清洗与分析。\n任职要求\n1. 了解 Python 或 SQL。\n2. 具备团队协作能力。",
        persistence: userText.includes("P51-BHV-ANALYZE") ? "analyze_only" : "save"
      }) } };
    }
    if (/从零|没有简历|开始帮我做/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.profile_intake_turn");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ userTurn: userText }) } };
    }
    if (/根据.*JD.*生成.*岗位简历/u.test(userText)) {
      const toolName = findToolName(tools, "career.workflow.tailor_resume");
      if (toolName) return { toolCall: { name: toolName, arguments: JSON.stringify({ targetText: "数据分析实习生，负责数据清洗、分析与报告，要求 Python 和 SQL 能力。" }) } };
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

function findCore02Payload(value, predicate, depth = 0) {
  if (depth > 16) return undefined;
  if (typeof value === "string") {
    const start = value.indexOf("{"); const end = value.lastIndexOf("}");
    if (start < 0 || end < start) return undefined;
    try { return findCore02Payload(JSON.parse(value.slice(start, end + 1)), predicate, depth + 1); } catch { return undefined; }
  }
  if (!value || typeof value !== "object") return undefined;
  if (predicate(value)) return value;
  for (const entry of Object.values(value)) { const found = findCore02Payload(entry, predicate, depth + 1); if (found) return found; }
  return undefined;
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
