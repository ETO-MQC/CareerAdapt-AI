import type { ApplicationStatus } from "@/domain/schemas";

const terminalStatuses = new Set<ApplicationStatus>(["offer", "rejected", "withdrawn"]);

const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  discovered: ["preparing", "withdrawn", "archived"],
  preparing: ["discovered", "ready", "withdrawn", "archived"],
  ready: ["preparing", "applied", "withdrawn", "archived"],
  applied: ["interviewing", "rejected", "withdrawn", "archived"],
  interviewing: ["applied", "offer", "rejected", "withdrawn", "archived"],
  offer: ["archived"],
  rejected: ["archived"],
  withdrawn: ["archived"],
  archived: []
};

export function canTransitionApplicationStatus(from: ApplicationStatus, to: ApplicationStatus) {
  if (from === to) {
    return true;
  }
  return transitions[from]?.includes(to) ?? false;
}

export function assertApplicationStatusTransition(from: ApplicationStatus, to: ApplicationStatus) {
  if (!canTransitionApplicationStatus(from, to)) {
    throw new Error("invalid_status_transition");
  }
}

export function isApplicationTerminalStatus(status: ApplicationStatus) {
  return terminalStatuses.has(status);
}

export function applicationStatusLabel(status: ApplicationStatus) {
  const labels: Record<ApplicationStatus, string> = {
    discovered: "发现机会",
    preparing: "准备材料",
    ready: "准备完成",
    applied: "已投递",
    interviewing: "面试中",
    offer: "已获 Offer",
    rejected: "已拒绝",
    withdrawn: "主动放弃",
    archived: "已归档"
  };
  return labels[status];
}

export function applicationStatusGroup(status: ApplicationStatus) {
  if (status === "discovered") {
    return "机会";
  }
  if (status === "preparing" || status === "ready") {
    return "准备中";
  }
  if (status === "applied") {
    return "已投递";
  }
  if (status === "interviewing") {
    return "面试中";
  }
  return "结果";
}

export const APPLICATION_STATUS_ORDER: ApplicationStatus[] = [
  "discovered",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  "archived"
];
