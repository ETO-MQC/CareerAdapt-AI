export const WORKSPACE_MODE_STORAGE_KEY = "careeradapt.workspaceMode.v1";
export const WORKSPACE_MODE_COOKIE_KEY = "careeradapt_workspace_mode";
export const WORKSPACE_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type WorkspaceMode = "ai" | "hybrid" | "manual";

export const WORKSPACE_MODE_OPTIONS: ReadonlyArray<{
  value: WorkspaceMode;
  label: string;
}> = [
  { value: "ai", label: "AI 模式" },
  { value: "hybrid", label: "协作模式" },
  { value: "manual", label: "手动模式" }
];

export function parseWorkspaceMode(value: unknown): WorkspaceMode | undefined {
  return value === "ai" || value === "hybrid" || value === "manual" ? value : undefined;
}

export function readWorkspaceMode(
  storage: Pick<Storage, "getItem"> | undefined,
  cookieValue?: string
): WorkspaceMode {
  return parseWorkspaceMode(storage?.getItem(WORKSPACE_MODE_STORAGE_KEY))
    ?? parseWorkspaceMode(cookieValue)
    ?? "ai";
}

export function persistWorkspaceMode(
  mode: WorkspaceMode,
  storage: Pick<Storage, "setItem">,
  cookieTarget: { cookie: string }
) {
  storage.setItem(WORKSPACE_MODE_STORAGE_KEY, mode);
  cookieTarget.cookie = `${WORKSPACE_MODE_COOKIE_KEY}=${mode}; Path=/; Max-Age=${WORKSPACE_MODE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
