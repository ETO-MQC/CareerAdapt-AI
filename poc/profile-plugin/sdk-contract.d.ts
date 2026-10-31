/** Minimal structural subset of the public SDK at locked eb527605; build external. */
declare module "@hermes/plugin-sdk" {
  import type { ReactNode } from "react";
  export const ROUTES_AREA: string;
  export const SIDEBAR_NAV_AREA: string;
  export const host: { navigate(path: string): void; notify(message: string): void };
  export interface PluginContribution { id: string; area: string; title?: string; data?: unknown; render?: () => ReactNode }
  export interface PluginContext { registerMany(items: PluginContribution[]): () => void }
  export interface HermesPlugin { id: string; name?: string; defaultEnabled?: boolean; register(ctx: PluginContext): void }
}
