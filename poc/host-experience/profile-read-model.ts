import { z } from 'zod';
import fixture from './profile-fixture.json';
const fieldSchema = z.object({ key: z.string(), label: z.string(), values: z.array(z.string()), multiline: z.boolean() }).strict();
const itemSchema = z.object({ id: z.string(), category: z.string(), title: z.string(), subtitle: z.string(), body: z.string(), date: z.string(), fields: z.array(fieldSchema), sources: z.array(z.string()), used: z.boolean(), archived: z.boolean(), updatedAt: z.string(), data: z.record(z.string(), z.unknown()) }).strict();
export const displayProfileSchema = z.object({ marker: z.literal('合成示例 · 只读 · 未连接正式资料库'), name: z.string(), version: z.string(), createdAt: z.string(), background: z.string(), basics: z.array(fieldSchema), categories: z.array(z.object({ id: z.string(), sectionType: z.string(), label: z.string(), repeatable: z.boolean() }).strict()), items: z.array(itemSchema) }).strict();
export type DisplayProfile = z.infer<typeof displayProfileSchema>;
export type DisplayItem = DisplayProfile['items'][number];
export interface FaithfulReadClient {
    getProfile(): Promise<unknown>;
}
export const faithfulReadClient: FaithfulReadClient = { getProfile: async () => structuredClone(fixture) };
export const faithfulScenarios: Record<string, FaithfulReadClient> = { success: faithfulReadClient, empty: { getProfile: async () => null }, error: { getProfile: async () => { throw Error('合成资料服务暂不可用，请重试。'); } }, invalid: { getProfile: async () => ({ invalid: true }) }, loading: { getProfile: () => new Promise(() => { }) } };
