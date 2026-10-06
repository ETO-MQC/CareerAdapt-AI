/**
 * V4-P1 阶段 4：application transition projection 与 follow-up cadence。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo —
 * services/applications.py 的 _TRANSITIONS 状态机与
 * services/action_center.py 的 _FOLLOW_UP_CADENCE 跟进节奏。
 *
 * 迁移约束（v4-plan.md §7.6）：
 * - 状态必须映射到现有 ApplicationStatus（discovered/preparing/ready/applied/
 *   interviewing/offer/rejected/withdrawn/archived）；不引入 submitted、
 *   acknowledged 等参考实现中的新状态（submitted→applied，acknowledged 并入
 *   applied 的等待语义，interview_completed 并入 interviewing）；
 * - 网申辅助状态放 applicationDrafts（V4-P2），正式投递状态仍由
 *   ApplicationRecord 管理；本模块不读写存储；
 * - cadence 只对"已投递且未终结"的状态生效；超周期未进展的投递转为沉寂
 *   （停止提醒），投递本身不受影响。
 */

import type { ApplicationStatus } from "@/domain/schemas/application";

export const APPLICATION_TRANSITION_ALGORITHM = "careeradapt-application-transition-v1";
export const FOLLOW_UP_CADENCE_ALGORITHM = "careeradapt-follow-up-cadence-v1";

const NON_TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  "discovered",
  "preparing",
  "ready",
  "applied",
  "interviewing"
];

/**
 * 合法状态转移表（v1 政策，全部显式可测）：
 * - 前向推进：discovered → preparing → ready → applied → interviewing → 终态；
 * - archived 是生命周期操作，任何非终态都可进入；终态（offer/rejected/
 *   withdrawn）只能归档，不再参与投递推进；
 * - 不提供回退边（如 applied → preparing）：回退走 restore/编辑流程，
 *   不是状态机的一部分。
 */
export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  discovered: ["preparing", "archived"],
  preparing: ["ready", "archived"],
  ready: ["applied", "archived"],
  applied: ["interviewing", "rejected", "withdrawn", "archived"],
  interviewing: ["offer", "rejected", "withdrawn", "archived"],
  offer: ["archived"],
  rejected: ["archived"],
  withdrawn: ["archived"],
  archived: []
};

export function applicationTransitionError(from: ApplicationStatus, to: ApplicationStatus): "invalid_application_transition" | undefined {
  return APPLICATION_TRANSITIONS[from].includes(to) ? undefined : "invalid_application_transition";
}

export function applicationStatusTerminal(status: ApplicationStatus): boolean {
  return !NON_TERMINAL_STATUSES.includes(status);
}

export type FollowUpCadence = {
  intervalDays: number;
  maxFollowUps: number;
};

/**
 * 跟进节奏表（值取自参考实现）：
 * - applied（submitted）一周一跟进，最多 2 次；
 * - interviewing（活跃对话中）5 天一跟进，最多 2 次；
 * - 其余状态不生成自动跟进。
 */
export const FOLLOW_UP_CADENCE: Readonly<Partial<Record<ApplicationStatus, FollowUpCadence>>> = {
  applied: { intervalDays: 7, maxFollowUps: 2 },
  interviewing: { intervalDays: 5, maxFollowUps: 2 }
};

export type FollowUpProjection =
  | { kind: "none" }
  | { kind: "due"; cycle: number; maxFollowUps: number; isFinalCycle: boolean; ageDays: number };

/**
 * 由"状态 + 最近进展时间"投影当前是否该跟进。
 * - 未满一个周期：不提醒；
 * - 第 cycle 个周期（age // interval）：提醒；cycle 超过上限即沉寂；
 * - 最后一个周期必须显式说明是最后一次，之后提醒静默消失。
 * now 由调用方注入，本模块不读时钟。
 */
export function projectFollowUp(
  input: { status: ApplicationStatus; updatedAt: string },
  now: string
): FollowUpProjection {
  const cadence = FOLLOW_UP_CADENCE[input.status];
  if (!cadence) return { kind: "none" };
  const ageMs = new Date(now).getTime() - new Date(input.updatedAt).getTime();
  if (ageMs < 0) return { kind: "none" };
  const intervalMs = cadence.intervalDays * 24 * 60 * 60 * 1000;
  if (ageMs < intervalMs) return { kind: "none" };
  const cycle = Math.floor(ageMs / intervalMs);
  if (cycle > cadence.maxFollowUps) return { kind: "none" };
  return {
    kind: "due",
    cycle,
    maxFollowUps: cadence.maxFollowUps,
    isFinalCycle: cycle === cadence.maxFollowUps,
    ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000))
  };
}
