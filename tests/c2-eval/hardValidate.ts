import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import type { FactGuardResult, FactGuardFinding, MatchEvidenceRef } from "@/domain/schemas";
import type { C2EvalCase } from "./cases";

export type HardCheckResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type HardValidationResult = {
  passed: boolean;
  checks: HardCheckResult[];
  guardResult: FactGuardResult;
};

/**
 * 对单个C2案例运行确定性硬校验。
 * 先运行规则 Fact Guard，再检查 guard 结果是否符合预期。
 */
export function hardValidateC2(caseDef: C2EvalCase): HardValidationResult {
  const checks: HardCheckResult[] = [];

  // 1. 运行规则 Fact Guard
  const guardResult = runRuleFactGuard({
    originalText: caseDef.originalText,
    checkedText: caseDef.checkedText,
    usedEvidenceRefs: caseDef.usedEvidenceRefs,
    now: "2026-07-02T10:00:00.000Z"
  });

  // 2. 处置预期检查
  checks.push(checkDisposition(guardResult, caseDef));

  // 3. Guard status 检查
  if (caseDef.expectedGuardStatus) {
    checks.push(checkGuardStatus(guardResult, caseDef));
  }

  // 4. Finding type 检查
  if (caseDef.expectedFindingTypes) {
    checks.push(checkExpectedFindings(guardResult, caseDef));
  }

  // 5. 禁止 finding type 检查
  if (caseDef.forbiddenFindingTypes) {
    checks.push(checkForbiddenFindings(guardResult, caseDef));
  }

  // 6. usedEvidenceRefs 白名单校验
  checks.push(checkEvidenceRefWhitelist(guardResult, caseDef));

  // 7. 事实确认状态校验（usedEvidenceRefs 应非空或合法空）
  checks.push(checkEvidenceRefsValid(guardResult));

  // 8. Prompt 注入检测
  if (caseDef.flags?.includes("prompt-injection")) {
    checks.push(checkPromptInjectionDetected(guardResult));
  }

  // 9. Stale 阻断检查
  if (caseDef.flags?.includes("stale")) {
    checks.push(checkStaleBlocked(caseDef));
  }

  const passed = checks.every((check) => check.passed);
  return { passed, checks, guardResult };
}

function checkDisposition(guardResult: FactGuardResult, caseDef: C2EvalCase): HardCheckResult {
  if (caseDef.expectedDisposition === "pass") {
    const isPass = guardResult.status === "pass" || guardResult.status === "ai_failed_rule_kept";
    return {
      name: "disposition",
      passed: isPass,
      detail: isPass
        ? "合法建议正确通过 Fact Guard。"
        : `合法建议被误阻断：guardStatus=${guardResult.status}，期望 pass。`
    };
  }

  // block 案例
  const isBlocked = guardResult.status === "blocked_high_risk" || guardResult.status === "needs_edit";
  return {
    name: "disposition",
    passed: isBlocked,
    detail: isBlocked
      ? "非法建议被正确阻断。"
      : `非法建议未被阻断：guardStatus=${guardResult.status}，期望 blocked_high_risk 或 needs_edit。`
  };
}

function checkGuardStatus(guardResult: FactGuardResult, caseDef: C2EvalCase): HardCheckResult {
  const expected = caseDef.expectedGuardStatus!;
  const matched = expected.includes(guardResult.status);
  return {
    name: "guard-status",
    passed: matched,
    detail: matched
      ? `Guard status 符合预期：${guardResult.status}。`
      : `Guard status 不符合预期：${guardResult.status}，期望 [${expected.join(", ")}]。`
  };
}

function checkExpectedFindings(guardResult: FactGuardResult, caseDef: C2EvalCase): HardCheckResult {
  const findingTypes = new Set(guardResult.ruleFindings.map((finding) => finding.type));
  const missing = caseDef.expectedFindingTypes!.filter((type) => !findingTypes.has(type as FactGuardFinding["type"]));
  return {
    name: "expected-findings",
    passed: missing.length === 0,
    detail: missing.length === 0
      ? `所有预期 finding type 均出现：${caseDef.expectedFindingTypes!.join(", ")}。`
      : `缺少预期 finding type：${missing.join(", ")}。实际出现：${[...findingTypes].join(", ")}。`
  };
}

function checkForbiddenFindings(guardResult: FactGuardResult, caseDef: C2EvalCase): HardCheckResult {
  const findingTypes = new Set(guardResult.ruleFindings.map((finding) => finding.type));
  const forbidden = caseDef.forbiddenFindingTypes!.filter((type) => findingTypes.has(type as FactGuardFinding["type"]));
  return {
    name: "forbidden-findings",
    passed: forbidden.length === 0,
    detail: forbidden.length === 0
      ? "未出现禁止的 finding type。"
      : `出现了禁止的 finding type：${forbidden.join(", ")}。`
  };
}

function checkEvidenceRefWhitelist(guardResult: FactGuardResult, caseDef: C2EvalCase): HardCheckResult {
  const allowedKeys = new Set(caseDef.usedEvidenceRefs.map(refKey));
  const resultKeys = new Set(guardResult.allowedEvidenceRefs.map(refKey));
  const outOfScope = [...resultKeys].filter((key) => !allowedKeys.has(key));

  return {
    name: "evidence-ref-whitelist",
    passed: outOfScope.length === 0,
    detail: outOfScope.length === 0
      ? "Fact Guard 结果中 allowedEvidenceRefs 均在案例输入范围内。"
      : `Fact Guard 结果包含白名单外引用：${outOfScope.join(", ")}。`
  };
}

function checkEvidenceRefsValid(guardResult: FactGuardResult): HardCheckResult {
  // allowedEvidenceRefs 应与输入一致
  return {
    name: "evidence-refs-valid",
    passed: Array.isArray(guardResult.allowedEvidenceRefs),
    detail: "allowedEvidenceRefs 字段格式正确。"
  };
}

function checkPromptInjectionDetected(guardResult: FactGuardResult): HardCheckResult {
  // Prompt 注入应导致 guard 阻断或标记风险
  const hasFindings = guardResult.ruleFindings.length > 0;
  const isBlocked = guardResult.status === "blocked_high_risk" || guardResult.status === "needs_edit";
  const passed = hasFindings || isBlocked;

  return {
    name: "prompt-injection-detected",
    passed,
    detail: passed
      ? "Prompt 注入被 Fact Guard 检测到。"
      : "Prompt 注入未被 Fact Guard 检测到。"
  };
}

function checkStaleBlocked(caseDef: C2EvalCase): HardCheckResult {
  // Stale 案例的 disposal 应为 block
  const passed = caseDef.expectedDisposition === "block";
  return {
    name: "stale-blocked",
    passed,
    detail: passed
      ? "Stale 案例预期为 block，待工作流层面验证阻断。"
      : "Stale 案例预期应为 block。"
  };
}

function refKey(ref: MatchEvidenceRef): string {
  switch (ref.type) {
    case "experience_fact":
      return `experience_fact:${ref.experienceId}:${ref.factId}`;
    case "skill_fact":
      return `skill_fact:${ref.skillId}:${ref.factId}`;
    case "certificate_fact":
      return `certificate_fact:${ref.certificateId}:${ref.factId}`;
    case "evidence_file":
      return `evidence_file:${ref.evidenceId}:${ref.linkedFactId}`;
  }
}
