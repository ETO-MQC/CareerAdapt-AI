"use client";

import { useState } from "react";
import type { CareerProfile, ResumeBranch } from "@/domain/schemas";
import { FieldInput } from "../FieldInput";
import { SectionShell } from "../SectionShell";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type DraftField = "name" | "targetRole" | "email" | "phone" | "location" | "linkedin";

type BasicsSectionPageProps = {
  profile?: CareerProfile;
  branch?: ResumeBranch;
  branchEditable: boolean;
  profileFieldError?: string;
  onSaveProfileField: (fieldId: string, value: string) => void;
  onSaveBranchBasicsField: (field: "targetRole", value: string) => void;
  nav: SectionNavContext;
};

function getFieldValue(profile: CareerProfile | undefined, branch: ResumeBranch | undefined, field: DraftField): string {
  const basics = branch?.resumeBasics;
  switch (field) {
    case "name": return basics?.name ?? profile?.basics.name ?? "";
    case "targetRole": return basics?.targetRole ?? "";
    case "email": return basics?.email ?? profile?.basics.email ?? "";
    case "phone": return basics?.phone ?? profile?.basics.phone ?? "";
    case "location": return basics?.location ?? profile?.basics.location ?? "";
    case "linkedin": return basics?.links?.[0] ?? profile?.basics.links?.[0] ?? "";
  }
}

const FIELD_SAVE_MAP: Record<DraftField, (value: string, props: BasicsSectionPageProps) => void> = {
  name: (v, p) => p.onSaveProfileField("profile:name", v),
  targetRole: (v, p) => p.onSaveBranchBasicsField("targetRole", v),
  email: (v, p) => p.onSaveProfileField("profile:email", v),
  phone: (v, p) => p.onSaveProfileField("profile:phone", v),
  location: (v, p) => p.onSaveProfileField("profile:location", v),
  linkedin: (v, p) => p.onSaveProfileField("profile:link:0", v),
};

export function BasicsSectionPage(props: BasicsSectionPageProps) {
  const { profile, branch, profileFieldError, nav } = props;
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);

  const [dirtyValues, setDirtyValues] = useState<Partial<Record<DraftField, string>>>({});

  function handleChange(field: DraftField, value: string) {
    setDirtyValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleBlur(field: DraftField) {
    const dirtyValue = dirtyValues[field];
    if (dirtyValue !== undefined) {
      FIELD_SAVE_MAP[field](dirtyValue, props);
    }
    setDirtyValues((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function getValue(field: DraftField): string {
    return dirtyValues[field] ?? getFieldValue(profile, branch, field);
  }

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">人</span>}
      title="个人信息"
      description="添加您的联系方式和位置，以便雇主可以联系您。"
      saved={Object.keys(dirtyValues).length === 0}
      canUndo={nav.canUndo}
      canRedo={nav.canRedo}
      onUndo={nav.onUndo}
      onRedo={nav.onRedo}
      hasPrev={Boolean(prev)}
      hasNext={Boolean(next)}
      onPrev={() => prev && nav.onNavigate(prev)}
      onNext={() => next && nav.onNavigate(next)}
    >
      <div className="section-fields">
        <FieldInput
          label="全名"
          id="basics-name"
          value={getValue("name")}
          placeholder="张三"
          autoComplete="name"
          onChange={(v) => handleChange("name", v)}
          onBlur={() => handleBlur("name")}
          error={profileFieldError}
        />
        <FieldInput
          label="目标职位"
          id="basics-headline"
          value={getValue("targetRole")}
          placeholder="例如：软件工程师"
          hint="显示在简历顶部，例如：开发工程师。不会改变简历名称。"
          onChange={(v) => handleChange("targetRole", v)}
          onBlur={() => handleBlur("targetRole")}
        />
        <div className="section-fields-grid-2">
          <FieldInput
            label="电子邮件"
            id="basics-email"
            type="email"
            inputMode="email"
            value={getValue("email")}
            placeholder="zhangsan@example.com"
            autoComplete="email"
            onChange={(v) => handleChange("email", v)}
            onBlur={() => handleBlur("email")}
          />
          <FieldInput
            label="电话"
            id="basics-phone"
            type="tel"
            inputMode="tel"
            value={getValue("phone")}
            placeholder="+86 138 0013 8000"
            autoComplete="tel"
            onChange={(v) => handleChange("phone", v)}
            onBlur={() => handleBlur("phone")}
          />
        </div>
        <FieldInput
          label="地址"
          id="basics-address"
          value={getValue("location")}
          placeholder="城市，省份，国家（可选）"
          onChange={(v) => handleChange("location", v)}
          onBlur={() => handleBlur("location")}
        />
        <FieldInput
          label="个人主页 / LinkedIn"
          id="basics-linkedin"
          type="url"
          inputMode="url"
          value={getValue("linkedin")}
          placeholder="https://linkedin.com/in/your-profile"
          autoComplete="url"
          onChange={(v) => handleChange("linkedin", v)}
          onBlur={() => handleBlur("linkedin")}
        />
      </div>
    </SectionShell>
  );
}
