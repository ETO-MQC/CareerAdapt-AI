import type { CustomFieldValue, ResumeBranchBasics } from "@/domain/schemas";

export const PERSONAL_FIELD_PRESETS = ["微信", "性别", "年龄", "出生日期", "政治面貌", "籍贯", "民族", "当前状态", "个人网站", "GitHub", "LinkedIn"];
export type ContactDetail = { id: string; label: string; value: string };
export function customContactValue(value: CustomFieldValue["value"]) {
  return Array.isArray(value) ? value.join("、") : typeof value === "boolean" ? value ? "是" : "否" : String(value);
}
export function editCustomContactValue(field: CustomFieldValue, text: string): CustomFieldValue {
  if (field.valueType === "number") {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`${field.label}需要填写有效数字。`);
    return { ...field, value: Number(text) };
  }
  if (field.valueType === "boolean") {
    if (!["是", "否", "true", "false"].includes(text.trim())) throw new Error(`${field.label}请填写“是”或“否”。`);
    return { ...field, value: text.trim() === "是" || text.trim() === "true" };
  }
  return { ...field, value: field.valueType === "string_list" ? text.split(/[、\n]/).map(value => value.trim()).filter(Boolean) : text };
}
export function resumeContactDetails(basics: ResumeBranchBasics): ContactDetail[] {
  return [
    { id: "phone", label: "手机号", value: basics.phone },
    { id: "email", label: "邮箱", value: basics.email },
    { id: "location", label: "地址", value: basics.location },
    ...basics.links.map((value, index) => ({ id: `link:${index}`, label: "个人网站", value })),
    ...(basics.customFields ?? []).map(field => ({ id: `custom:${field.id}`, label: field.label, value: customContactValue(field.value) }))
  ];
}
export function orderContactDetails(details: ContactDetail[], order: string[] = []) {
  const byId = new Map(details.map(detail => [detail.id, detail]));
  const keys = [...new Set([...order, ...details.map(detail => detail.id)])];
  return keys.flatMap(id => id.startsWith("break:") ? [{ id, label: "换行", value: "" }] : byId.has(id) ? [byId.get(id)!] : []);
}
