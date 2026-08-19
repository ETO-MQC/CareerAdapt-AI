"use client";

import { nanoid } from "nanoid";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Award, BadgeCheck, BookOpen, Briefcase, Folder, FlaskConical, GraduationCap, Grid2X2, Heart, Languages, List, MessageCircle, MoreHorizontal, Search, School, ShieldCheck, UserRound, Wrench } from "lucide-react";
import { invokeStageBAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { PDF_IMPORT_EXTRACTION_VERSION } from "@/domain/pdfImport/limits";
import { applyPdfSourceMappingToProfileOutput, isPdfEvidenceLocated } from "@/domain/pdfImport/sourceMapping";
import { buildPageTextRecords, combinePdfPageTexts, preparePdfText } from "@/domain/pdfImport/text";
import { validatePdfFileDescriptor, validatePdfHeader } from "@/domain/pdfImport/validation";
import { mapProfileDraftToCareerProfile } from "@/domain/mappers/profileDraftMapper";
import { migrateCareerProfileToV2, normalizeAwardedAt } from "@/domain/migrations/resumeV2";
import {
  CareerProfileSchema,
  ResumeItemV2Schema,
  ProfileBuilderOutputSchema,
  type PdfImportErrorCode,
  type PdfImportSession,
  type PdfPageText,
  type Certificate,
  type CareerProfile,
  type Experience,
  type ExperienceType,
  type FactCategory,
  type ProfileBuilderFact,
  type ProfileBuilderOutput,
  type ProfileImportDraft,
  type ProfileRecycleItem,
  type RawInputDocument,
  type ResumeBranch,
  type ResumeItemV2,
  type Skill
} from "@/domain/schemas";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { FieldInput } from "@/components/editor/FieldInput";
import {
  ProductTopbar
} from "@/components/ui/product";
import { CareerContextEntryBar } from "@/components/career/CareerContextEntryBar";
import { StructuredExperienceForm } from "@/components/editor/StructuredExperienceForm";
import { StructuredProjectForm } from "@/components/editor/StructuredProjectForm";
import {
  defaultExperienceType,
  emptyStructuredExperienceFields,
  canonicalToStructuredExperienceFields,
  patchCanonicalExperienceFields,
  canonicalToStructuredProjectFields,
  emptyStructuredProjectFields,
  patchCanonicalProjectFields,
  type StructuredExperienceFields,
  type StructuredProjectFields
} from "@/domain/resumeFields/catalog";
import { canonicalProfileBasics, canonicalProfileLibraryItems, canonicalProfileSectionCounts, profileSectionCatalog } from "@/domain/profile/canonicalLibrary";
import {
  canonicalSectionTypeForProfileCategory,
  profileCategoryForCanonicalSection,
  type ProfileUiCategoryId
} from "@/domain/profile/profileCategories";
import { extractTextFromPdfBuffer } from "@/services/pdf/extractText";
import { buildProfileJsonExport, profileJsonExportFileName } from "@/services/export/profileJson";
import { hashBytes, hashText, redactSensitiveTextForModel } from "@/services/security/text";
import { notify } from "@/services/notifications/store";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import { countProfileContent, profileCountSummary } from "@/domain/profile/profileCounts";
import { buildProfileContentIntegrity, canonicalProfileContentCounts } from "@/domain/profile/profileContentIntegrity";
import { experienceEditorContentCounts, experienceDocumentToEditorHtml } from "@/components/editor/helpers";

const repository = new WorkspaceRepository();
const pdfInputId = "resume-pdf-upload";
const profileArchiveKey = (profileId: string) => `profileArchive:${profileId}:skills`;
const profileArchiveV2Key = (profileId: string) => `profileArchive:${profileId}:managed-items`;

type ProfileCategoryId = ProfileUiCategoryId;
type ProfileUsageFilter = "all" | "used" | "unused" | "archived";
type ProfileManagedKind = "basic" | "summary" | "experience" | "certificate" | "skill" | "custom" | "canonical";

type ArchivedCustomBlock = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

type ProfileArchiveState = {
  experiences: Experience[];
  certificates: Certificate[];
  skills: Skill[];
  customBlocks: ArchivedCustomBlock[];
};

type ProfileManagedItem = {
  key: string;
  id: string;
  kind: ProfileManagedKind;
  category: ProfileCategoryId;
  title: string;
  subtitle: string;
  body: string;
  source: string;
  usage: string;
  used: boolean;
  archived: boolean;
  updatedAt: string;
  experienceType?: ExperienceType;
  skillLevel?: Skill["level"];
  date?: string;
  structured?: StructuredExperienceFields;
  projectStructured?: StructuredProjectFields;
  canonicalData?: ResumeItemV2;
};

export type ProfileItemDraft = StructuredExperienceFields & {
  projectFields: StructuredProjectFields;
  title: string;
  subtitle: string;
  body: string;
  date: string;
  level: Skill["level"];
  experienceType: ExperienceType;
};

const emptyProfileArchive: ProfileArchiveState = {
  experiences: [],
  certificates: [],
  skills: [],
  customBlocks: []
};

const profileCategories = profileSectionCatalog.map((section) => ({
  id: profileCategoryForCanonicalSection(section.id),
  sectionType: section.id,
  label: section.label,
  description: section.repeatable ? "可复用的已确认资料" : "当前人物的基础资料",
  repeatable: section.repeatable
}));

const profileCategoryIcons: Record<ProfileCategoryId, typeof UserRound> = {
  basics: UserRound,
  summary: MessageCircle,
  education: GraduationCap,
  work: Briefcase,
  internship: Briefcase,
  project: Folder,
  research: FlaskConical,
  campus: School,
  volunteer: Heart,
  award: Award,
  skill: Wrench,
  certificate: BadgeCheck,
  language: Languages,
  publications: BookOpen,
  patents: ShieldCheck,
  portfolio: Grid2X2,
  other: MoreHorizontal,
  custom: List
};

const emptyProfileItemDraft: ProfileItemDraft = {
  ...emptyStructuredExperienceFields,
  projectFields: emptyStructuredProjectFields,
  title: "",
  subtitle: "",
  body: "",
  date: "",
  level: "familiar",
  experienceType: "work"
};

type BasicDraft = {
  name: string;
  headline: string;
  phone: string;
  email: string;
  location: string;
  link: string;
};

type BasicDraftState = BasicDraft & {
  profileKey: string;
};

type NewProfileDraft = BasicDraft & {
  summary: string;
};

const emptyBasicDraft: BasicDraftState = { name: "", headline: "", phone: "", email: "", location: "", link: "", profileKey: "" };
const emptyNewProfileDraft: NewProfileDraft = { name: "", headline: "", phone: "", email: "", location: "", link: "", summary: "" };

export function ProfileWorkspace() {
  const [importWorkspaceOpen, setImportWorkspaceOpen] = useState(false);
  const workspace = useWorkspace(repository);
  const pdfAbortRef = useRef<AbortController | undefined>(undefined);
  const [importMode, setImportMode] = useState<"paste" | "pdf">("paste");
  const [rawText, setRawText] = useState("");
  const [rawInput, setRawInput] = useState<RawInputDocument | undefined>();
  const [draft, setDraft] = useState<ProfileImportDraft | undefined>();
  const [pdfSession, setPdfSession] = useState<PdfImportSession | undefined>();
  const [pdfPages, setPdfPages] = useState<PdfPageText[]>([]);
  const [pdfText, setPdfText] = useState("");
  const [userEditedAiText, setUserEditedAiText] = useState("");
  const [pdfStatus, setPdfStatus] = useState<"idle" | "validating" | "extracting" | "extracted" | "failed" | "cancelled">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [loadedDraft, setLoadedDraft] = useState(false);
  const managerRef = useRef<HTMLElement | null>(null);
  const [profileOverride, setProfileOverride] = useState<CareerProfile | null | undefined>();
  const refetchWorkspace = workspace.refetch;
  useEffect(() => {
    const refreshContext = () => {
      setProfileOverride(undefined);
      void refetchWorkspace();
    };
    window.addEventListener("careeradapt-career-context-change", refreshContext);
    return () => window.removeEventListener("careeradapt-career-context-change", refreshContext);
  }, [refetchWorkspace]);
  const [profileDeleteOpen, setProfileDeleteOpen] = useState(false);
  const [profileDeleting, setProfileDeleting] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileExporting, setProfileExporting] = useState(false);
  const [blockerDialogOpen, setBlockerDialogOpen] = useState(false);
  const [blockers, setBlockers] = useState<{ branches: number; matches: number; matchOperations: number; adaptationDrafts: number; applications: number; commits: number } | null>(null);
  const [clearingCategory, setClearingCategory] = useState<string | null>(null);
  const [forceDeleteDialog, setForceDeleteDialog] = useState<{ item: ProfileManagedItem; referenceCount: number } | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedBatchKeys, setSelectedBatchKeys] = useState<Set<string>>(new Set());
  const [basicDraftState, setBasicDraftState] = useState<BasicDraftState>(emptyBasicDraft);
  const [profileArchive, setProfileArchive] = useState<ProfileArchiveState>(emptyProfileArchive);
  const [activeProfileCategory, setActiveProfileCategory] = useState<ProfileCategoryId>("basics");
  const [selectedProfileItemKey, setSelectedProfileItemKey] = useState("basic:profile");
  const [profileSearch, setProfileSearch] = useState("");
  const [profileUsageFilter, setProfileUsageFilter] = useState<ProfileUsageFilter>("all");
  const [profileItemDraft, setProfileItemDraft] = useState<ProfileItemDraft>(emptyProfileItemDraft);
  const [profileItemEditing, setProfileItemEditing] = useState(false);
  const [newProfileDraft, setNewProfileDraft] = useState<NewProfileDraft>(emptyNewProfileDraft);
  const [profileOverrides, setProfileOverrides] = useState<Record<string, CareerProfile>>({});
  const [removedProfileIds, setRemovedProfileIds] = useState<string[]>([]);
  const [generalResumeState, setGeneralResumeState] = useState<{ profileId: string; resume?: ResumeBranch }>();

  useEffect(() => {
    let active = true;

    async function loadDraft() {
      const latest = await repository.getLatestProfileImportDraft();
      if (!active || !latest) {
        setLoadedDraft(true);
        return;
      }

      const raw = await repository.getRawInput(latest.rawInputId);
      if (!active) {
        return;
      }

      setDraft(latest);
      setRawInput(raw);
      setRawText(raw?.rawText ?? "");
      setUserEditedAiText(raw?.userEditedAiText ?? raw?.rawText ?? "");
      if (raw?.kind === "resume_pdf_text") {
        setImportMode("pdf");
      }
      setLoadedDraft(true);
    }

    void loadDraft();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPdfSession() {
      const latest = await repository.getLatestPdfImportSession();
      if (!active || !latest) {
        return;
      }

      const pages = await repository.listPdfPageTexts(latest.id);
      if (!active) {
        return;
      }

      setPdfSession(latest);
      setPdfPages(pages);
      const combined = combinePdfPageTexts(pages);
      setPdfText(combined);
      setUserEditedAiText((current) => current || combined);
      if (latest.status === "extracted" || latest.status === "awaiting_privacy_confirmation" || latest.status === "draft_ready") {
        setPdfStatus("extracted");
      } else if (latest.status === "cancelled") {
        setPdfStatus("cancelled");
      } else if (latest.status === "extracting" || latest.status === "parsing") {
        setPdfStatus("failed");
        if (active) {
          notify({ type: "error", title: "PDF 提取中断", message: "上次会话未完成，请重新选择原始 PDF 文件导入。" });
        }
      } else if (latest.status === "interrupted") {
        setPdfStatus("failed");
        notify({ type: "error", title: "PDF 提取中断", message: "上次会话未完成，请重新选择原始 PDF 文件导入。" });
      } else if (latest.status === "failed") {
        setPdfStatus("failed");
      }
    }

    void loadPdfSession();

    return () => {
      active = false;
      pdfAbortRef.current?.abort();
    };
  }, []);

  const redactionPreview = useMemo(() => redactSensitiveTextForModel(rawText), [rawText]);
  const output = draft?.manualSections ?? draft?.builderOutput;
  const pdfHasPromptInjectionRisk = Boolean(pdfSession?.hasPromptInjectionRisk);
  const availableProfiles = useMemo(() => {
    const workspaceProfiles = workspace.status === "ready" ? workspace.profiles : [];
    const byId = new Map(workspaceProfiles.filter((item) => !removedProfileIds.includes(item.id)).map((item) => [item.id, item]));
    Object.values(profileOverrides).forEach((item) => {
      if (!removedProfileIds.includes(item.id)) byId.set(item.id, item);
    });
    return Array.from(byId.values());
  }, [profileOverrides, removedProfileIds, workspace]);
  const activeCareerContext = workspace.activeContext;
  const workspaceProfile = activeCareerContext
    ? availableProfiles.find((item) => item.id === activeCareerContext.profileId)
    : undefined;
  const profile = profileOverride === undefined ? workspaceProfile : profileOverride ?? undefined;
  const generalResume = generalResumeState?.profileId === profile?.id ? generalResumeState?.resume : undefined;
  const profileCounts = profile ? countProfileContent(profile) : undefined;
  const profileDraftKey = profile ? `${profile.id}:${profile.version}` : "";
  const basicDraft = profile && basicDraftState.profileKey !== profileDraftKey
    ? basicDraftFromProfile(profile, profileDraftKey)
    : basicDraftState;
  const profileManagedItems = useMemo(
    () => profile ? buildProfileManagedItems(profile, profileArchive, activeProfileCategory, profileSearch, profileUsageFilter) : [],
    [activeProfileCategory, profile, profileArchive, profileSearch, profileUsageFilter]
  );
  const creatingNewProfile = selectedProfileItemKey.startsWith("new-profile:");
  const selectedProfileItem = creatingNewProfile
    ? undefined
    : profileManagedItems.find((item) => item.key === selectedProfileItemKey) ?? profileManagedItems[0];
  const profileCategoryCounts = useMemo(
    () => profile ? buildProfileCategoryCounts(profile, profileArchive) : new Map<ProfileCategoryId, number>(),
    [profile, profileArchive]
  );
  const integrityEditorSource = activeProfileCategory === "project"
    ? (profileItemEditing ? profileItemDraft.projectFields : selectedProfileItem?.projectStructured)
    : (profileItemEditing ? profileItemDraft : selectedProfileItem?.structured);
  const integrityEditorDocument = integrityEditorSource
    ? {
        description: integrityEditorSource.description,
        highlights: integrityEditorSource.highlights,
        outcomes: integrityEditorSource.outcomes ?? [],
        tools: integrityEditorSource.tools ?? [],
        background: integrityEditorSource.background ?? ""
      }
    : undefined;
  const integrityEditorHtml = integrityEditorDocument
    ? experienceDocumentToEditorHtml(integrityEditorDocument)
    : "";
  const profileContentIntegrity = profile
    ? buildProfileContentIntegrity({
        profile,
        ...(integrityEditorDocument ? { editorProjection: integrityEditorDocument } : {}),
        renderedEditorCounts: {
          ...experienceEditorContentCounts(integrityEditorHtml),
          ...(integrityEditorDocument ? {
            items: 1,
            tools: integrityEditorDocument.tools.length
          } : {})
        },
        generalResume
      })
    : undefined;

  function setBasicDraft(nextDraft: BasicDraft) {
    setBasicDraftState({ ...nextDraft, profileKey: profileDraftKey });
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
    if (selectedProfileItemKey.startsWith("new:") || selectedProfileItemKey.startsWith("new-profile:")) {
      return;
    }
    if (profileManagedItems.length === 0) {
      setSelectedProfileItemKey(`new:${activeProfileCategory}`);
      return;
    }
    if (!profileManagedItems.some((item) => item.key === selectedProfileItemKey)) {
      setSelectedProfileItemKey(profileManagedItems[0].key);
    }
    });
    return () => {
      active = false;
    };
  }, [activeProfileCategory, profileManagedItems, selectedProfileItemKey]);

  useEffect(() => {
    if (profileItemEditing || !selectedProfileItem) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setProfileItemDraft(profileDraftFromItem(selectedProfileItem));
    });
    return () => {
      active = false;
    };
  }, [profileItemEditing, selectedProfileItem]);

  useEffect(() => {
    if (!profile?.id) {
      return;
    }

    let active = true;
    const profileId = profile.id;
    async function loadArchive() {
      const stored = await repository.getMeta(profileArchiveKey(profileId));
      const storedV2 = await repository.getMeta(profileArchiveV2Key(profileId));
      if (!active) {
        return;
      }
      const legacySkills = parseArchivedSkills(stored?.value);
      setProfileArchive(parseProfileArchive(storedV2?.value, legacySkills));
    }
    void loadArchive();

    return () => {
      active = false;
    };
  }, [profile?.id]);

  useEffect(() => {
    let active = true;
    if (!profile?.id) {
      return () => { active = false; };
    }
    const profileId = profile.id;
    void repository.listResumeBranches(profileId).then((branches) => {
      if (!active) return;
      setGeneralResumeState({
        profileId,
        resume: branches.find((branch) => branch.branchPurpose === "general" && branch.lifecycleStatus === "active")
      });
    });
    return () => { active = false; };
  }, [profile?.id, profile?.version]);
  async function saveProfileSnapshot(nextProfile: CareerProfile, successMessage: string) {
    setProfileSaving(true);
    try {
      const saved = await repository.saveProfile(synchronizeProfileStructuredFacts(nextProfile, profile));
      const readback = await repository.getProfile(saved.id);
      if (!readback || readback.version !== saved.version) throw new Error("profile_content_readback_missing");
      const expectedCounts = canonicalProfileContentCounts(saved);
      const readbackCounts = canonicalProfileContentCounts(readback);
      if (JSON.stringify(expectedCounts) !== JSON.stringify(readbackCounts)) throw new Error("profile_content_readback_mismatch");
      setProfileOverride(saved);
      setProfileOverrides((current) => ({ ...current, [saved.id]: saved }));
      setSaveStatus("saved");
      notify({ type: "success", title: "保存成功", message: successMessage });
      return saved;
    } catch {
      setSaveStatus("failed");
      notify({ type: "error", title: "保存失败", message: "个人资料保存失败，请检查字段是否完整。" });
      return undefined;
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveProfileBasics() {
    if (!profile) {
      notify({ type: "warning", title: "无个人资料", message: "请先导入或创建个人资料。" });
      return;
    }
    const name = basicDraft.name.trim();
    if (!name) {
      notify({ type: "warning", title: "姓名必填", message: "姓名不能为空。" });
      return;
    }

    const now = new Date().toISOString();
    const canonical = migrateCareerProfileToV2(profile);
    await saveProfileSnapshot({
      ...profile,
      name,
      basics: {
        ...profile.basics,
        name,
        headline: optionalText(basicDraft.headline),
        phone: optionalText(basicDraft.phone),
        email: optionalText(basicDraft.email),
        location: optionalText(basicDraft.location),
        links: basicDraft.link.trim() ? [basicDraft.link.trim()] : []
      },
      schemaVersion: "career-profile-v2",
      structuredBasics: {
        ...canonical.structuredBasics,
        name,
        headline: optionalText(basicDraft.headline),
        phone: optionalText(basicDraft.phone),
        email: optionalText(basicDraft.email),
        location: optionalText(basicDraft.location),
        otherLinks: basicDraft.link.trim() ? [basicDraft.link.trim()] : []
      },
      structuredFacts: canonical.structuredFacts,
      version: profile.version + 1,
      updatedAt: now
    }, "个人资料已保存。");
  }

  async function saveProfileArchive(nextArchive: ProfileArchiveState) {
    if (!profile) {
      return;
    }
    setProfileArchive(nextArchive);
    await repository.setMeta(profileArchiveV2Key(profile.id), nextArchive);
  }

  function selectProfileCategory(category: ProfileCategoryId) {
    setActiveProfileCategory(category);
    setProfileUsageFilter("all");
    setProfileItemEditing(false);
    const nextItems = profile ? buildProfileManagedItems(profile, profileArchive, category, profileSearch, "all") : [];
    setSelectedProfileItemKey(nextItems[0]?.key ?? `new:${category}`);
  }

  function selectManagedProfileItem(item: ProfileManagedItem) {
    setSelectedProfileItemKey(item.key);
    setProfileItemDraft(profileDraftFromItem(item));
    setProfileItemEditing(false);
  }

  function startManagedProfileCreate() {
    if (activeProfileCategory === "basics" || activeProfileCategory === "summary") {
      setSelectedProfileItemKey(`new-profile:${activeProfileCategory}`);
      setNewProfileDraft(emptyNewProfileDraft);
      setProfileItemEditing(true);
      return;
    }
    const nextDraft = defaultProfileDraftForCategory(activeProfileCategory);
    setSelectedProfileItemKey(`new:${activeProfileCategory}`);
    setProfileItemDraft(nextDraft);
    setProfileItemEditing(true);
  }

  async function exportCurrentProfileJson() {
    if (profileExporting) return;
    if (!profile) {
      notify({ type: "warning", title: "无个人资料", message: "请先选择要导出的人物。" });
      return;
    }
    setProfileExporting(true);
    try {
      const [storedProfile, storedArchive, storedLegacyArchive] = await Promise.all([
        repository.getProfile(profile.id),
        repository.getMeta(profileArchiveV2Key(profile.id)),
        repository.getMeta(profileArchiveKey(profile.id))
      ]);
      if (!storedProfile) {
        notify({ type: "error", title: "导出失败", message: "当前人物资料已不存在，请刷新后重试。" });
        return;
      }
      const archive = parseProfileArchive(
        storedArchive?.value,
        parseArchivedSkills(storedLegacyArchive?.value)
      );
      const exportedAt = new Date().toISOString();
      const payload = buildProfileJsonExport({
        profile: storedProfile,
        archive,
        exportedAt
      });
      triggerJsonDownload(
        payload,
        profileJsonExportFileName(storedProfile, exportedAt.slice(0, 10))
      );
      notify({
        type: "success",
        title: "导出成功",
        message: `已导出 ${storedProfile.name} 的完整资料库 JSON。`
      });
    } catch {
      notify({ type: "error", title: "导出失败", message: "资料读取或 JSON 生成失败，请重试。" });
    } finally {
      setProfileExporting(false);
    }
  }

  async function saveNewProfile() {
    const name = newProfileDraft.name.trim();
    if (!name) {
      notify({ type: "warning", title: "姓名必填", message: "请先填写新人物的姓名。" });
      return;
    }
    if (activeProfileCategory === "summary" && !newProfileDraft.summary.trim()) {
      notify({ type: "warning", title: "自我评价必填", message: "请先填写新人物的自我评价。" });
      return;
    }
    const now = new Date().toISOString();
    const saved = await saveProfileSnapshot(CareerProfileSchema.parse({
      id: `profile-${nanoid(10)}`,
      name,
      basics: {
        name,
        headline: optionalText(newProfileDraft.headline),
        phone: optionalText(newProfileDraft.phone),
        email: optionalText(newProfileDraft.email),
        location: optionalText(newProfileDraft.location),
        summary: optionalText(newProfileDraft.summary),
        links: newProfileDraft.link.trim() ? [newProfileDraft.link.trim()] : []
      },
      preference: { targetRoles: [], targetCities: [], industries: [] },
      version: 1,
      experiences: [],
      skills: [],
      certificates: [],
      evidences: [],
      unclassifiedBlocks: [],
      createdAt: now,
      updatedAt: now
    }), "新人物资料已创建。");
    if (!saved) return;
    if (saved.personId) await repository.setActiveCareerContext({ personId: saved.personId, profileId: saved.id });
    setNewProfileDraft(emptyNewProfileDraft);
    setProfileItemEditing(false);
    setSelectedProfileItemKey(activeProfileCategory === "summary" ? "summary:profile" : "basic:profile");
  }

  function editCurrentProfile() {
    selectProfileCategory("basics");
    managerRef.current?.scrollIntoView({ block: "start" });
  }

  async function requestCurrentProfileDelete() {
    if (!profile) return;
    const currentBlockers = await repository.getProfileDeleteBlockers(profile.id);
    const referenceCount = Object.values(currentBlockers).reduce((sum, count) => sum + count, 0);
    if (referenceCount > 0) {
      setBlockers(currentBlockers);
      setBlockerDialogOpen(true);
      return;
    }
    setProfileDeleteOpen(true);
  }

  async function clearBlockerCategory(category: "branches" | "matches" | "matchOperations" | "adaptationDrafts" | "applications" | "commits") {
    if (!profile) return;
    setClearingCategory(category);
    try {
      await repository.clearProfileBlockers(profile.id, [category]);
      const updated = await repository.getProfileDeleteBlockers(profile.id);
      setBlockers(updated);
      const remaining = Object.values(updated).reduce((sum, count) => sum + count, 0);
      if (remaining === 0) {
        setBlockerDialogOpen(false);
        setProfileDeleteOpen(true);
      }
    } catch {
      notify({ type: "error", title: "清理失败", message: "请重试或刷新后重试。" });
    } finally {
      setClearingCategory(null);
    }
  }

  async function clearAllBlockers() {
    if (!profile || !blockers) return;
    setClearingCategory("all");
    try {
      const categoriesToClear = (Object.entries(blockers) as Array<[string, number]>)
        .filter(([, count]) => count > 0)
        .map(([key]) => key as "branches" | "matches" | "matchOperations" | "adaptationDrafts" | "applications" | "commits");
      await repository.clearProfileBlockers(profile.id, categoriesToClear);
      setBlockerDialogOpen(false);
      setProfileDeleteOpen(true);
    } catch {
      notify({ type: "error", title: "清理失败", message: "请重试或刷新后重试。" });
    } finally {
      setClearingCategory(null);
    }
  }

  async function forceDeleteProfile() {
    if (!profile) return;
    setProfileDeleting(true);
    try {
      await repository.forceDeleteProfile(profile.id);
      const deletedProfileId = profile.id;
      setRemovedProfileIds((current) => [...current, deletedProfileId]);
      await repository.clearActiveCareerContext();
      setProfileOverride(null);
      setBlockerDialogOpen(false);
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
      notify({ type: "success", title: "资料已删除", message: "关联数据已一并清理。" });
    } catch {
      notify({ type: "error", title: "删除失败", message: "个人资料未发生变化。" });
    } finally {
      setProfileDeleting(false);
    }
  }

  async function confirmCurrentProfileDelete() {
    if (!profile) return;
    setProfileDeleting(true);
    try {
      const result = await repository.deleteProfileIfUnreferenced(profile.id);
      if (!result.deleted) {
        setProfileDeleteOpen(false);
        notify({ type: "warning", title: "删除未执行", message: "资料在确认期间产生了新的关联，请先处理关联内容。" });
        return;
      }
      const deletedProfileId = profile.id;
      setRemovedProfileIds((current) => [...current, deletedProfileId]);
      await repository.clearActiveCareerContext();
      setProfileOverride(null);
      setProfileDeleteOpen(false);
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
      notify({ type: "success", title: "资料已删除", message: "导入草稿和已有文件记录未被级联删除。" });
    } catch {
      notify({ type: "error", title: "删除失败", message: "个人资料未发生变化。" });
    } finally {
      setProfileDeleting(false);
    }
  }

  function startManagedProfileEdit() {
    if (selectedProfileItem) {
      setProfileItemDraft(profileDraftFromItem(selectedProfileItem));
    }
    setProfileItemEditing(true);
  }

  async function saveManagedProfileItem() {
    if (!profile) {
      return;
    }

    if (activeProfileCategory === "basics") {
      await saveProfileBasics();
      setProfileItemEditing(false);
      return;
    }

    if (activeProfileCategory === "summary") {
      const summary = profileItemDraft.body.trim();
      if (!summary) {
        notify({ type: "warning", title: "自我评价必填", message: "请先填写自我评价。" });
        return;
      }
      const canonical = migrateCareerProfileToV2(profile);
      const summaryEntry = canonical.structuredFacts.find((entry) => entry.data.sectionType === "summary");
      const structuredFacts = summaryEntry
        ? canonical.structuredFacts.map((entry) => entry === summaryEntry ? { ...entry, data: { ...entry.data, text: summary } } : entry)
        : [{ data: { id: `profile-summary-${profile.id}`, sectionType: "summary" as const, text: summary, customFields: [] }, factIds: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }, ...canonical.structuredFacts];
      const saved = await saveProfileSnapshot({
        ...profile,
        basics: { ...profile.basics, summary },
        schemaVersion: "career-profile-v2",
        structuredBasics: { ...canonical.structuredBasics, summary },
        structuredFacts,
        version: profile.version + 1,
        updatedAt: new Date().toISOString()
      }, "自我评价已保存。");
      if (saved) setProfileItemEditing(false);
      return;
    }

    const title = profileItemDraft.title.trim();
    const body = profileItemDraft.body.trim();
    const structuredTitle = activeProfileCategory === "project"
      ? profileItemDraft.projectFields.title.trim()
      : profileItemDraft.organization.trim();
    const isStructuredCategory = activeProfileCategory === "education" || activeProfileCategory === "work" || activeProfileCategory === "internship" || activeProfileCategory === "project" || activeProfileCategory === "campus";
    if (!(isStructuredCategory ? structuredTitle : title) && activeProfileCategory !== "custom") {
      notify({ type: "warning", title: "名称必填", message: "请先填写条目名称。" });
      return;
    }
    if (activeProfileCategory === "custom" && !body) {
      notify({ type: "warning", title: "内容必填", message: "请先填写自定义内容。" });
      return;
    }

    const now = new Date().toISOString();
    let nextProfile = profile;
    const selected = selectedProfileItem?.key === selectedProfileItemKey ? selectedProfileItem : undefined;
    const isNew = selectedProfileItemKey.startsWith("new:");

    if (selected?.kind === "canonical" && selected.canonicalData) {
      const updatedData = patchCanonicalProfileDraft(selected.canonicalData, profileItemDraft);
      nextProfile = {
        ...profile,
        structuredFacts: (profile.structuredFacts ?? []).map((entry) =>
          entry.data.id === selected.id
            ? { ...entry, data: updatedData }
            : entry
        ),
        version: profile.version + 1,
        updatedAt: now
      };
    } else if (profile.schemaVersion === "career-profile-v2" && isNew && isStructuredProfileCategory(activeProfileCategory)) {
      const canonical = buildCanonicalProfileItemFromDraft(profileItemDraft, activeProfileCategory);
      nextProfile = {
        ...profile,
        structuredFacts: [
          ...(profile.structuredFacts ?? []),
          { data: canonical, factIds: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }
        ],
        version: profile.version + 1,
        updatedAt: now
      };
    } else if (activeProfileCategory === "certificate") {
      const certificate = buildCertificateFromDraft(profileItemDraft, selected?.id, now);
      nextProfile = {
        ...profile,
        certificates: isNew
          ? [...profile.certificates, certificate]
          : profile.certificates.map((item) => item.id === certificate.id ? certificate : item),
        version: profile.version + 1,
        updatedAt: now
      };
    } else if (activeProfileCategory === "skill" || activeProfileCategory === "language") {
      const skill = buildSkillFromDraft(profileItemDraft, activeProfileCategory, selected?.id, now);
      nextProfile = {
        ...profile,
        skills: isNew
          ? [...profile.skills, skill]
          : profile.skills.map((item) => item.id === skill.id ? skill : item),
        version: profile.version + 1,
        updatedAt: now
      };
    } else if (activeProfileCategory === "custom") {
      const nextBlocks = isNew
        ? [...profile.unclassifiedBlocks, body]
        : profile.unclassifiedBlocks.map((block, index) => `custom:${index}` === selected?.id ? body : block);
      nextProfile = {
        ...profile,
        unclassifiedBlocks: nextBlocks,
        version: profile.version + 1,
        updatedAt: now
      };
    } else {
      const experience = buildExperienceFromDraft(profileItemDraft, activeProfileCategory, selected?.id, now);
      nextProfile = {
        ...profile,
        experiences: isNew
          ? [...profile.experiences, experience]
          : profile.experiences.map((item) => item.id === experience.id ? experience : item),
        version: profile.version + 1,
        updatedAt: now
      };
    }

    const saved = await saveProfileSnapshot(nextProfile, isNew ? "资料条目已创建。" : "资料条目已更新。");
    if (saved) {
      setProfileItemEditing(false);
      const nextItems = buildProfileManagedItems(saved, profileArchive, activeProfileCategory, profileSearch, profileUsageFilter);
      const nextSelected = isNew ? nextItems.at(-1) : nextItems.find((item) => item.id === selected?.id);
      setSelectedProfileItemKey(nextSelected?.key ?? nextItems[0]?.key ?? `new:${activeProfileCategory}`);
    }
  }

  async function archiveManagedProfileItem(item: ProfileManagedItem) {
    if (!profile || item.kind === "basic" || item.kind === "summary" || item.archived) {
      return;
    }

    const now = new Date().toISOString();
    let nextProfile = profile;
    let nextArchive = profileArchive;
    if (item.kind === "experience") {
      const target = profile.experiences.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, experiences: [{ ...target, updatedAt: now }, ...profileArchive.experiences.filter((entry) => entry.id !== item.id)] };
      nextProfile = { ...profile, experiences: profile.experiences.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
    } else if (item.kind === "certificate") {
      const target = profile.certificates.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, certificates: [{ ...target, updatedAt: now }, ...profileArchive.certificates.filter((entry) => entry.id !== item.id)] };
      nextProfile = { ...profile, certificates: profile.certificates.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
    } else if (item.kind === "skill") {
      const target = profile.skills.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, skills: [{ ...target, updatedAt: now }, ...profileArchive.skills.filter((entry) => entry.id !== item.id)] };
      nextProfile = { ...profile, skills: profile.skills.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
    } else if (item.kind === "canonical") {
      const factEntry = (profile.structuredFacts ?? []).find((entry) => entry.data.id === item.id);
      if (!factEntry) return;
      nextArchive = {
        ...profileArchive,
        customBlocks: [{ id: `custom-archive-${nanoid(8)}`, text: item.body, createdAt: now, updatedAt: now }, ...profileArchive.customBlocks]
      };
      nextProfile = { ...profile, structuredFacts: (profile.structuredFacts ?? []).filter((entry) => entry.data.id !== item.id), version: profile.version + 1, updatedAt: now };
    } else {
      const index = Number(item.id.replace("custom:", ""));
      const target = profile.unclassifiedBlocks[index];
      if (!target) {
        return;
      }
      nextArchive = {
        ...profileArchive,
        customBlocks: [{ id: `custom-archive-${nanoid(8)}`, text: target, createdAt: now, updatedAt: now }, ...profileArchive.customBlocks]
      };
      nextProfile = {
        ...profile,
        unclassifiedBlocks: profile.unclassifiedBlocks.filter((_, blockIndex) => blockIndex !== index),
        version: profile.version + 1,
        updatedAt: now
      };
    }

    const saved = await saveProfileSnapshot(nextProfile, "资料条目已归档，可在筛选中恢复。");
    if (saved) {
      await saveProfileArchive(nextArchive);
      setSelectedProfileItemKey(buildProfileManagedItems(saved, nextArchive, activeProfileCategory, profileSearch, profileUsageFilter)[0]?.key ?? `new:${activeProfileCategory}`);
    }
  }

  async function restoreManagedProfileItem(item: ProfileManagedItem) {
    if (!profile || !item.archived) {
      return;
    }

    const now = new Date().toISOString();
    let nextProfile = profile;
    let nextArchive = profileArchive;
    if (item.kind === "experience") {
      const target = profileArchive.experiences.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, experiences: profileArchive.experiences.filter((entry) => entry.id !== item.id) };
      nextProfile = { ...profile, experiences: [...profile.experiences, { ...target, updatedAt: now }], version: profile.version + 1, updatedAt: now };
    } else if (item.kind === "certificate") {
      const target = profileArchive.certificates.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, certificates: profileArchive.certificates.filter((entry) => entry.id !== item.id) };
      nextProfile = { ...profile, certificates: [...profile.certificates, { ...target, updatedAt: now }], version: profile.version + 1, updatedAt: now };
    } else if (item.kind === "skill") {
      const target = profileArchive.skills.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, skills: profileArchive.skills.filter((entry) => entry.id !== item.id) };
      nextProfile = { ...profile, skills: [...profile.skills, { ...target, updatedAt: now }], version: profile.version + 1, updatedAt: now };
    } else {
      const target = profileArchive.customBlocks.find((entry) => entry.id === item.id);
      if (!target) {
        return;
      }
      nextArchive = { ...profileArchive, customBlocks: profileArchive.customBlocks.filter((entry) => entry.id !== item.id) };
      nextProfile = { ...profile, unclassifiedBlocks: [...profile.unclassifiedBlocks, target.text], version: profile.version + 1, updatedAt: now };
    }

    const saved = await saveProfileSnapshot(nextProfile, "资料条目已恢复。");
    if (saved) {
      await saveProfileArchive(nextArchive);
      setSelectedProfileItemKey(buildProfileManagedItems(saved, nextArchive, activeProfileCategory, profileSearch, profileUsageFilter)[0]?.key ?? `new:${activeProfileCategory}`);
    }
  }

  async function trashManagedProfileItem(item: ProfileManagedItem) {
    if (!profile || item.kind === "basic" || item.kind === "summary") return;
    const referenceCount = await repository.getProfileItemReferenceCount({ kind: item.kind, id: item.id });
    if (referenceCount > 0) {
      setForceDeleteDialog({ item, referenceCount });
      return;
    }

    const now = new Date().toISOString();
    let nextProfile = profile;
    let nextArchive = profileArchive;
    let recycleItem: ProfileRecycleItem | undefined;
    if (item.kind === "experience") {
      const value = (item.archived ? profileArchive.experiences : profile.experiences).find((entry) => entry.id === item.id);
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, experiences: profile.experiences.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, experiences: profileArchive.experiences.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "experience", category: item.category, title: item.title, deletedAt: now, value };
    } else if (item.kind === "certificate") {
      const value = (item.archived ? profileArchive.certificates : profile.certificates).find((entry) => entry.id === item.id);
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, certificates: profile.certificates.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, certificates: profileArchive.certificates.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "certificate", category: item.category, title: item.title, deletedAt: now, value };
    } else if (item.kind === "skill") {
      const value = (item.archived ? profileArchive.skills : profile.skills).find((entry) => entry.id === item.id);
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, skills: profile.skills.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, skills: profileArchive.skills.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "skill", category: item.category, title: item.title, deletedAt: now, value };
    } else if (item.kind === "canonical") {
      const factEntry = (profile.structuredFacts ?? []).find((entry) => entry.data.id === item.id);
      if (!factEntry) return;
      nextProfile = { ...profile, structuredFacts: (profile.structuredFacts ?? []).filter((entry) => entry.data.id !== item.id), version: profile.version + 1, updatedAt: now };
      recycleItem = { id: item.id, profileId: profile.id, kind: "canonical", category: item.category, title: item.title, deletedAt: now, value: factEntry };
    } else {
      const activeIndex = Number(item.id.replace("custom:", ""));
      const archived = profileArchive.customBlocks.find((entry) => entry.id === item.id);
      const value = item.archived ? archived?.text : profile.unclassifiedBlocks[activeIndex];
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, unclassifiedBlocks: profile.unclassifiedBlocks.filter((_, index) => index !== activeIndex), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, customBlocks: profileArchive.customBlocks.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "custom", category: item.category, title: item.title, deletedAt: now, value };
    }

    const saved = nextProfile === profile ? profile : await saveProfileSnapshot(nextProfile, "资料条目已移入回收站。");
    if (!saved || !recycleItem) return;
    if (nextArchive !== profileArchive) await saveProfileArchive(nextArchive);
    await repository.addProfileRecycleItem(recycleItem);
    const nextItems = buildProfileManagedItems(saved, nextArchive, activeProfileCategory, profileSearch, profileUsageFilter);
    setSelectedProfileItemKey(nextItems[0]?.key ?? `new:${activeProfileCategory}`);
    notify({ type: "success", title: "已移入回收站", message: "可在统一回收站恢复。" });
  }

  async function confirmForceTrashItem() {
    if (!forceDeleteDialog || !profile) return;
    const { item } = forceDeleteDialog;
    setForceDeleteDialog(null);

    const now = new Date().toISOString();
    let nextProfile = profile;
    let nextArchive = profileArchive;
    let recycleItem: ProfileRecycleItem | undefined;
    if (item.kind === "experience") {
      const value = (item.archived ? profileArchive.experiences : profile.experiences).find((entry) => entry.id === item.id);
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, experiences: profile.experiences.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, experiences: profileArchive.experiences.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "experience", category: item.category, title: item.title, deletedAt: now, value };
    } else if (item.kind === "certificate") {
      const value = (item.archived ? profileArchive.certificates : profile.certificates).find((entry) => entry.id === item.id);
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, certificates: profile.certificates.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, certificates: profileArchive.certificates.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "certificate", category: item.category, title: item.title, deletedAt: now, value };
    } else if (item.kind === "skill") {
      const value = (item.archived ? profileArchive.skills : profile.skills).find((entry) => entry.id === item.id);
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, skills: profile.skills.filter((entry) => entry.id !== item.id), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, skills: profileArchive.skills.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "skill", category: item.category, title: item.title, deletedAt: now, value };
    } else if (item.kind === "canonical") {
      const factEntry = (profile.structuredFacts ?? []).find((entry) => entry.data.id === item.id);
      if (!factEntry) return;
      nextProfile = { ...profile, structuredFacts: (profile.structuredFacts ?? []).filter((entry) => entry.data.id !== item.id), version: profile.version + 1, updatedAt: now };
      recycleItem = { id: item.id, profileId: profile.id, kind: "canonical", category: item.category, title: item.title, deletedAt: now, value: factEntry };
    } else {
      const activeIndex = Number(item.id.replace("custom:", ""));
      const archived = profileArchive.customBlocks.find((entry) => entry.id === item.id);
      const value = item.archived ? archived?.text : profile.unclassifiedBlocks[activeIndex];
      if (!value) return;
      nextProfile = item.archived ? profile : { ...profile, unclassifiedBlocks: profile.unclassifiedBlocks.filter((_, index) => index !== activeIndex), version: profile.version + 1, updatedAt: now };
      nextArchive = item.archived ? { ...profileArchive, customBlocks: profileArchive.customBlocks.filter((entry) => entry.id !== item.id) } : profileArchive;
      recycleItem = { id: item.id, profileId: profile.id, kind: "custom", category: item.category, title: item.title, deletedAt: now, value };
    }

    const saved = nextProfile === profile ? profile : await saveProfileSnapshot(nextProfile, "资料条目已强制移入回收站。");
    if (!saved || !recycleItem) return;
    if (nextArchive !== profileArchive) await saveProfileArchive(nextArchive);
    await repository.addProfileRecycleItem(recycleItem);

    // Clean up references in resume branches
    const branches = await repository.listResumeBranches(profile.id);
    const refType = item.kind === "experience" ? "experience_fact"
      : item.kind === "skill" ? "skill_fact"
        : item.kind === "certificate" ? "certificate_fact" : null;
    if (refType) {
      const idField = item.kind === "experience" ? "experienceId"
        : item.kind === "skill" ? "skillId"
          : "certificateId";
      for (const branch of branches) {
        const cleanedItems = branch.contentItems.filter((contentItem) =>
          !contentItem.factRefs.some((ref) => ref.type === refType && ref[idField as keyof typeof ref] === item.id)
        );
        if (cleanedItems.length !== branch.contentItems.length) {
          // saveResumeBranch calls migrateResumeBranchToV2 which auto-syncs structuredContentItems
          await repository.saveResumeBranch({ ...branch, contentItems: cleanedItems, updatedAt: now });
        }
      }
    }

    const nextItems = buildProfileManagedItems(saved, nextArchive, activeProfileCategory, profileSearch, profileUsageFilter);
    setSelectedProfileItemKey(nextItems[0]?.key ?? `new:${activeProfileCategory}`);
    const cleanedCount = branches.length > 0 ? "，已同步清理简历引用" : "";
    notify({ type: "success", title: "已强制移入回收站", message: `可在统一回收站恢复${cleanedCount}。` });
  }

  function toggleBatchItem(key: string) {
    setSelectedBatchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function batchTrashItems() {
    if (!profile || selectedBatchKeys.size === 0) return;
    const items = profileManagedItems.filter((item) => selectedBatchKeys.has(item.key) && item.kind !== "basic" && item.kind !== "summary");
    if (items.length === 0) return;

    const now = new Date().toISOString();
    let nextProfile = profile;
    let nextArchive = profileArchive;
    const recycleItems: ProfileRecycleItem[] = [];

    for (const item of items) {
      if (item.kind === "experience") {
        const value = (item.archived ? nextArchive.experiences : nextProfile.experiences).find((entry) => entry.id === item.id);
        if (!value) continue;
        nextProfile = item.archived ? nextProfile : { ...nextProfile, experiences: nextProfile.experiences.filter((entry) => entry.id !== item.id), version: nextProfile.version + 1, updatedAt: now };
        nextArchive = item.archived ? { ...nextArchive, experiences: nextArchive.experiences.filter((entry) => entry.id !== item.id) } : nextArchive;
        recycleItems.push({ id: item.id, profileId: profile.id, kind: "experience", category: item.category, title: item.title, deletedAt: now, value });
      } else if (item.kind === "certificate") {
        const value = (item.archived ? nextArchive.certificates : nextProfile.certificates).find((entry) => entry.id === item.id);
        if (!value) continue;
        nextProfile = item.archived ? nextProfile : { ...nextProfile, certificates: nextProfile.certificates.filter((entry) => entry.id !== item.id), version: nextProfile.version + 1, updatedAt: now };
        nextArchive = item.archived ? { ...nextArchive, certificates: nextArchive.certificates.filter((entry) => entry.id !== item.id) } : nextArchive;
        recycleItems.push({ id: item.id, profileId: profile.id, kind: "certificate", category: item.category, title: item.title, deletedAt: now, value });
      } else if (item.kind === "skill") {
        const value = (item.archived ? nextArchive.skills : nextProfile.skills).find((entry) => entry.id === item.id);
        if (!value) continue;
        nextProfile = item.archived ? nextProfile : { ...nextProfile, skills: nextProfile.skills.filter((entry) => entry.id !== item.id), version: nextProfile.version + 1, updatedAt: now };
        nextArchive = item.archived ? { ...nextArchive, skills: nextArchive.skills.filter((entry) => entry.id !== item.id) } : nextArchive;
        recycleItems.push({ id: item.id, profileId: profile.id, kind: "skill", category: item.category, title: item.title, deletedAt: now, value });
      } else if (item.kind === "canonical") {
        const factEntry = (nextProfile.structuredFacts ?? []).find((entry) => entry.data.id === item.id);
        if (!factEntry) continue;
        nextProfile = { ...nextProfile, structuredFacts: (nextProfile.structuredFacts ?? []).filter((entry) => entry.data.id !== item.id), version: nextProfile.version + 1, updatedAt: now };
        recycleItems.push({ id: item.id, profileId: profile.id, kind: "canonical", category: item.category, title: item.title, deletedAt: now, value: factEntry });
      } else {
        const activeIndex = Number(item.id.replace("custom:", ""));
        const archived = nextArchive.customBlocks.find((entry) => entry.id === item.id);
        const value = item.archived ? archived?.text : nextProfile.unclassifiedBlocks[activeIndex];
        if (!value) continue;
        nextProfile = item.archived ? nextProfile : { ...nextProfile, unclassifiedBlocks: nextProfile.unclassifiedBlocks.filter((_, index) => index !== activeIndex), version: nextProfile.version + 1, updatedAt: now };
        nextArchive = item.archived ? { ...nextArchive, customBlocks: nextArchive.customBlocks.filter((entry) => entry.id !== item.id) } : nextArchive;
        recycleItems.push({ id: item.id, profileId: profile.id, kind: "custom", category: item.category, title: item.title, deletedAt: now, value });
      }
    }

    if (recycleItems.length === 0) return;

    const saved = nextProfile === profile ? profile : await saveProfileSnapshot(nextProfile, `批量移除 ${recycleItems.length} 个资料条目。`);
    if (!saved) return;
    if (nextArchive !== profileArchive) await saveProfileArchive(nextArchive);
    for (const ri of recycleItems) await repository.addProfileRecycleItem(ri);

    // Clean up references in resume branches
    const branches = await repository.listResumeBranches(profile.id);
    const deletedIds = new Set(recycleItems.map((ri) => ri.id));
    for (const branch of branches) {
      const cleanedItems = branch.contentItems.filter((contentItem) =>
        !contentItem.factRefs.some((ref) => {
          if (ref.type === "experience_fact") return deletedIds.has(ref.experienceId);
          if (ref.type === "skill_fact") return deletedIds.has(ref.skillId);
          if (ref.type === "certificate_fact") return deletedIds.has(ref.certificateId);
          return false;
        })
      );
      if (cleanedItems.length !== branch.contentItems.length) {
        // saveResumeBranch calls migrateResumeBranchToV2 which auto-syncs structuredContentItems
        await repository.saveResumeBranch({ ...branch, contentItems: cleanedItems, updatedAt: now });
      }
    }

    setBatchMode(false);
    setSelectedBatchKeys(new Set());
    const nextItems = buildProfileManagedItems(saved, nextArchive, activeProfileCategory, profileSearch, profileUsageFilter);
    setSelectedProfileItemKey(nextItems[0]?.key ?? `new:${activeProfileCategory}`);
    notify({ type: "success", title: "批量删除完成", message: `已移除 ${recycleItems.length} 个条目并清理简历引用，可在统一回收站恢复。` });
  }

  async function handlePdfFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    setImportMode("pdf");
    setPdfStatus("validating");
    notify({ type: "info", title: "正在校验", message: "本地校验 PDF 文件，原始文件不会上传。" });

    const descriptorValidation = validatePdfFileDescriptor(file);
    if (!descriptorValidation.ok) {
      setPdfStatus("failed");
      notify({ type: "error", title: "文件校验失败", message: descriptorValidation.message });
      return;
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const headerValidation = validatePdfHeader(bytes);
    if (!headerValidation.ok) {
      setPdfStatus("failed");
      notify({ type: "error", title: "文件头校验失败", message: headerValidation.message });
      return;
    }

    const now = new Date().toISOString();
    const fileHash = await hashBytes(bytes);
    const duplicate = await repository.findPdfImportByFileHash(fileHash);
    const nextSession: PdfImportSession = {
      id: `pdf-session-${nanoid(10)}`,
      status: "extracting",
      fileName: file.name,
      fileSize: file.size,
      mimeType: descriptorValidation.mimeType,
      extension: descriptorValidation.extension,
      fileHash,
      pageCount: 0,
      textLength: 0,
      extractionVersion: PDF_IMPORT_EXTRACTION_VERSION,
      hasPromptInjectionRisk: false,
      warnings: descriptorValidation.warnings,
      createdAt: now,
      updatedAt: now
    };

    await repository.createPdfImportSession(nextSession);
    setPdfSession(nextSession);
    setPdfPages([]);
    setPdfText("");
    setUserEditedAiText("");
    setPdfStatus("extracting");
    notify({
      type: "info",
      title: "正在提取 PDF",
      message: [
        duplicate ? "检测到同一 PDF 曾经导入过；本次仍会创建新的本地导入会话。" : "正在本地提取 PDF 文本。",
        descriptorValidation.warnings.length > 0 ? "浏览器 MIME 或扩展名仅作辅助判断，已继续执行文件头和 PDF.js 校验。" : ""
      ].filter(Boolean).join(" ")
    });

    const controller = new AbortController();
    pdfAbortRef.current = controller;
    const extracted = await extractTextFromPdfBuffer(buffer, controller.signal);
    pdfAbortRef.current = undefined;

    if (!extracted.ok) {
      await failPdfSession(nextSession, extracted.code, extracted.message, extracted.code === "extract_cancelled" ? "cancelled" : "failed");
      return;
    }

    const prepared = preparePdfText(extracted.pages);
    if (!prepared.ok) {
      await failPdfSession(nextSession, prepared.code, prepared.message);
      return;
    }

    const hashes = await Promise.all(prepared.pages.map(async (page) => ({
      rawTextHash: await hashText(page.rawText),
      cleanedTextHash: await hashText(page.cleanedText)
    })));
    const pageRecords = buildPageTextRecords({
      sessionId: nextSession.id,
      pages: prepared.pages,
      hashes,
      now: new Date().toISOString()
    });
    await repository.savePdfPageTexts(nextSession.id, pageRecords);

    const normalizedTextHash = await hashText(prepared.combinedText);
    const savedSession = await repository.updatePdfImportSession({
      ...nextSession,
      status: "extracted",
      pageCount: extracted.pageCount,
      textLength: prepared.combinedText.length,
      normalizedTextHash,
      hasPromptInjectionRisk: prepared.hasPromptInjectionRisk,
      warnings: [...descriptorValidation.warnings, ...prepared.warnings],
      errorCode: undefined,
      errorMessage: undefined
    });

    setPdfSession(savedSession);
    setPdfPages(pageRecords);
    setPdfText(prepared.combinedText);
    setUserEditedAiText(prepared.combinedText);
    setPdfStatus("extracted");
    notify({
      type: prepared.hasPromptInjectionRisk ? "warning" : "success",
      title: "PDF 提取完成",
      message: prepared.hasPromptInjectionRisk
        ? "检测到类似 Prompt 注入的文字，系统会当作简历内容处理，不会执行其中指令。"
        : "请预览来源后再进入隐私确认。"
    });
  }

  async function startPdfDraft() {
    const aiInputText = userEditedAiText.trim();
    if (!pdfSession || pdfPages.length === 0 || !pdfText.trim() || !aiInputText) {
      notify({ type: "warning", title: "需要 PDF 文本", message: "请先选择文本型 PDF 并完成本地提取。" });
      return;
    }

    const now = new Date().toISOString();
    const normalizedTextHash = pdfSession.normalizedTextHash ?? await hashText(pdfText);
    const aiInputHash = await hashText(aiInputText);
    const sourceTextKind = aiInputText === pdfText ? "pdf_cleaned_text" : "pdf_user_edited_text";
    const sourcePages = pdfPages.map((page) => ({
      pageNumber: page.pageNumber,
      start: page.charStart,
      end: page.charEnd,
      rawTextHash: page.rawTextHash,
      cleanedTextHash: page.cleanedTextHash
    }));
    const inputChanged = rawInput?.sourceSessionId === pdfSession.id && rawInput.aiInputHash !== aiInputHash;
    const nextRawInput: RawInputDocument = {
      id: rawInput?.sourceSessionId === pdfSession.id ? rawInput.id : `raw-${nanoid(10)}`,
      kind: "resume_pdf_text",
      rawText: aiInputText,
      inputHash: normalizedTextHash,
      title: `PDF导入：${pdfSession.fileName}`,
      sourceSessionId: pdfSession.id,
      sourceTextKind,
      normalizedTextHash,
      aiInputHash,
      privacyConfirmedAiInputHash: undefined,
      userEditedAiText: sourceTextKind === "pdf_user_edited_text" ? aiInputText : undefined,
      fileName: pdfSession.fileName,
      fileSize: pdfSession.fileSize,
      mimeType: pdfSession.mimeType,
      pageCount: pdfSession.pageCount,
      sourcePages,
      createdAt: rawInput?.sourceSessionId === pdfSession.id ? rawInput.createdAt : now,
      updatedAt: now
    };

    await repository.saveRawInput(nextRawInput);
    const existingDraft = draft?.rawInputId === nextRawInput.id ? draft : undefined;
    const nextDraft: ProfileImportDraft = {
      id: existingDraft?.id ?? `profile-draft-${nanoid(10)}`,
      rawInputId: nextRawInput.id,
      revision: existingDraft?.revision ?? 0,
      status: "privacy_pending",
      promptVersion: promptVersions.profileBuilder,
      attemptCount: existingDraft?.attemptCount ?? 0,
      builderOutput: inputChanged ? undefined : existingDraft?.builderOutput,
      manualSections: inputChanged ? undefined : existingDraft?.manualSections,
      pendingFacts: inputChanged ? [] : existingDraft?.pendingFacts ?? [],
      privacyConfirmedAiInputHash: undefined,
      createdAt: existingDraft?.createdAt ?? now,
      updatedAt: now
    };

    const savedDraft = existingDraft
      ? await repository.saveProfileImportDraftRevision(nextDraft, existingDraft.revision)
      : await repository.createProfileImportDraft(nextDraft);
    const savedSession = await repository.updatePdfImportSession({
      ...pdfSession,
      status: "awaiting_privacy_confirmation",
      aiInputHash,
      sourceTextKind,
      rawInputId: nextRawInput.id,
      draftId: savedDraft.id
    });

    setPdfSession(savedSession);
    setRawInput(nextRawInput);
    setRawText(aiInputText);
    setDraft(savedDraft);
    notify({ type: "success", title: "草稿已保存", message: "请确认是否发送脱敏内容给外部模型。" });
  }

  function handlePdfAiInputChange(value: string) {
    setUserEditedAiText(value);
    if (rawInput?.sourceSessionId === pdfSession?.id && draft && draft.status !== "committed") {
      setDraft({
        ...draft,
        status: "privacy_pending",
        privacyConfirmedAiInputHash: undefined
      });
      notify({ type: "warning", title: "输入已变更", message: "AI 输入文本已修改，请重新保存草稿并完成隐私确认。" });
    }
  }

  async function cancelPdfExtraction() {
    pdfAbortRef.current?.abort();
    setPdfStatus("cancelled");
    if (pdfSession && pdfSession.status === "extracting") {
      const saved = await repository.updatePdfImportSession({
        ...pdfSession,
        status: "cancelled",
        errorCode: "extract_cancelled",
        errorMessage: "用户取消了 PDF 文本提取。"
      });
      setPdfSession(saved);
    }
    notify({ type: "info", title: "已取消提取", message: "已保留现有粘贴文本和草稿。" });
  }

  async function deleteCurrentPdfSession() {
    if (!pdfSession) {
      return;
    }

    await repository.deletePdfImportSession(pdfSession.id);
    setPdfSession(undefined);
    setPdfPages([]);
    setPdfText("");
    setUserEditedAiText("");
    setPdfStatus("idle");
    notify({ type: "success", title: "已删除导入记录", message: "已存在草稿将保留为手动处理线索。" });
  }

  async function startImport() {
    if (!rawText.trim()) {
      notify({ type: "warning", title: "需要简历文本", message: "请先粘贴简历文本。" });
      return;
    }

    const now = new Date().toISOString();
    const inputHash = await hashText(rawText);
    const nextRawInput: RawInputDocument = {
      id: rawInput?.kind === "resume_text" ? rawInput.id : `raw-${nanoid(10)}`,
      kind: "resume_text",
      rawText,
      inputHash,
      title: "简历文本导入",
      sourceTextKind: "plain_text",
      aiInputHash: inputHash,
      privacyConfirmedAiInputHash: undefined,
      createdAt: rawInput?.kind === "resume_text" ? rawInput.createdAt : now,
      updatedAt: now
    };

    await repository.saveRawInput(nextRawInput);
    const existingDraft = draft?.rawInputId === nextRawInput.id ? draft : undefined;
    const nextDraft: ProfileImportDraft = {
      id: existingDraft?.id ?? `profile-draft-${nanoid(10)}`,
      rawInputId: nextRawInput.id,
      revision: existingDraft?.revision ?? 0,
      status: "privacy_pending",
      promptVersion: promptVersions.profileBuilder,
      attemptCount: existingDraft?.attemptCount ?? 0,
      builderOutput: existingDraft?.builderOutput,
      manualSections: existingDraft?.manualSections,
      pendingFacts: existingDraft?.pendingFacts ?? [],
      privacyConfirmedAiInputHash: undefined,
      createdAt: existingDraft?.createdAt ?? now,
      updatedAt: now
    };

    const saved = existingDraft
      ? await repository.saveProfileImportDraftRevision(nextDraft, existingDraft.revision)
      : await repository.createProfileImportDraft(nextDraft);

    setRawInput(nextRawInput);
    setDraft(saved);
    notify({ type: "success", title: "已保存原文", message: "请确认是否发送脱敏内容给外部模型。" });
  }

  async function failPdfSession(
    session: PdfImportSession,
    code: PdfImportErrorCode,
    errorMessage: string,
    status: PdfImportSession["status"] = "failed"
  ) {
    const saved = await repository.updatePdfImportSession({
      ...session,
      status,
      errorCode: code,
      errorMessage
    });
    setPdfSession(saved);
    setPdfStatus(status === "cancelled" ? "cancelled" : "failed");
    notify({ type: "error", title: "PDF 导入失败", message: `${errorMessage} 可改用粘贴文本或手动创建。` });
  }

  async function updatePdfSessionStatus(status: PdfImportSession["status"], errorCode?: PdfImportErrorCode, errorMessage?: string) {
    const sourceSessionId = rawInput?.sourceSessionId;
    if (!sourceSessionId) {
      return;
    }

    const session = pdfSession?.id === sourceSessionId ? pdfSession : await repository.getPdfImportSession(sourceSessionId);
    if (!session) {
      return;
    }

    const saved = await repository.updatePdfImportSession({
      ...session,
      status,
      errorCode,
      errorMessage
    });
    setPdfSession(saved);
  }

  function mapAiErrorToPdfError(errorCode: string): PdfImportErrorCode {
    if (errorCode === "validation_failed" || errorCode === "client_schema_validation_failed") {
      return "schema_validation_failed";
    }
    return "ai_failed";
  }

  async function analyzeWithAi() {
    if (!draft || !rawInput) {
      return;
    }

    if (rawInput.kind === "resume_pdf_text" && userEditedAiText.trim() !== rawInput.rawText) {
      notify({ type: "warning", title: "输入已变更", message: "AI 输入文本已修改，请先使用当前文本重新创建草稿并完成隐私确认。" });
      return;
    }

    const aiInputHash = rawInput.aiInputHash ?? await hashText(rawInput.rawText);
    if (rawInput.privacyConfirmedAiInputHash && rawInput.privacyConfirmedAiInputHash !== aiInputHash) {
      const resetDraft = await saveDraft({
        ...draft,
        status: "privacy_pending",
        privacyConfirmedAiInputHash: undefined
      });
      setDraft(resetDraft);
      notify({ type: "warning", title: "输入已变更", message: "AI 输入已在隐私确认后发生变化，请重新确认后再解析。" });
      return;
    }

    if (rawInput.kind === "resume_pdf_text" && pdfPages.length === 0) {
      const pages = rawInput.sourceSessionId ? await repository.listPdfPageTexts(rawInput.sourceSessionId) : [];
      if (pages.length === 0) {
        await updatePdfSessionStatus("failed", "extract_interrupted", "pdf_page_text_missing");
        notify({ type: "error", title: "页文本缺失", message: "不能把来源不可靠的内容写入事实层，请重新导入或改用手动处理。" });
        return;
      }
      setPdfPages(pages);
    }

    const confirmedRawInput = await repository.saveRawInput({
      ...rawInput,
      privacyConfirmedAiInputHash: aiInputHash,
      updatedAt: new Date().toISOString()
    });
    setRawInput(confirmedRawInput);

    notify({ type: "info", title: "正在解析", message: "服务端会先脱敏并校验模型输出。" });
    const analyzingDraft = await saveDraft({
      ...draft,
      status: "analyzing",
      privacyConfirmedAiInputHash: aiInputHash
    });
    await updatePdfSessionStatus("parsing");

    const result = await invokeStageBAi({
      task: "profile-builder",
      businessInput: {
        rawText: confirmedRawInput.rawText,
        inputHash: aiInputHash
      },
      outputSchema: ProfileBuilderOutputSchema
    });

    await repository.saveAiLogs([result.log]);

    if (!result.ok) {
      const failedAttempt = analyzingDraft.attemptCount + 1;
      const manual = failedAttempt >= 2 || result.errorCode !== "validation_failed";
      const fallbackOutput = createManualProfileOutput(rawInput.rawText);
      const saved = await saveDraft({
        ...analyzingDraft,
        status: manual ? "manual_mode" : "error",
        attemptCount: failedAttempt,
        manualSections: manual ? fallbackOutput : analyzingDraft.manualSections,
        saveError: result.errorCode
      });
      notify({ type: manual ? "warning" : "error", title: manual ? "已进入手动模式" : "AI 解析失败", message: manual ? "AI 不可用或校验失败，已进入手动分类模式。" : "可重试或改用手动分类。" });
      setDraft(saved);
      await updatePdfSessionStatus("failed", mapAiErrorToPdfError(result.errorCode), result.errorCode);
      return;
    }

    const mappingPages = confirmedRawInput.kind === "resume_pdf_text"
      ? pdfPages.length > 0
        ? pdfPages
        : await repository.listPdfPageTexts(confirmedRawInput.sourceSessionId ?? "")
      : [];
    const builderOutput = confirmedRawInput.kind === "resume_pdf_text"
      ? applyPdfSourceMappingToProfileOutput(result.data, mappingPages)
      : result.data;

    const saved = await saveDraft({
      ...analyzingDraft,
      status: "ai_validated",
      attemptCount: analyzingDraft.attemptCount + 1,
      promptVersion: result.promptVersion,
      builderOutput,
      pendingFacts: builderOutput.experiences.flatMap((experience) => experience.facts),
      saveError: undefined
    });
    setDraft(saved);
    await updatePdfSessionStatus("draft_ready");
    notify({ type: "success", title: "解析完成", message: "请核对原文依据并勾选确认事实。" });
  }

  async function enterManualMode() {
    if (!draft || !rawInput) {
      return;
    }

    const saved = await saveDraft({
      ...draft,
      status: "manual_mode",
      manualSections: draft.manualSections ?? draft.builderOutput ?? createManualProfileOutput(rawInput.rawText)
    });
    setDraft(saved);
    notify({ type: "info", title: "手动模式", message: "已进入手动分类模式，外部模型不会被调用。" });
  }

  async function toggleFact(factId: string, checked: boolean) {
    if (!draft || !output) {
      return;
    }

    if (rawInput?.kind === "resume_pdf_text" && checked) {
      const fact = output.experiences.flatMap((experience) => experience.facts).find((item) => item.id === factId)
        ?? output.skills.find((item) => item.id === factId)
        ?? output.certificates.find((item) => item.id === factId);
      if (fact && !isPdfEvidenceLocated(fact)) {
        notify({ type: "warning", title: "来源未定位", message: "该事实在 PDF 页文本中未唯一定位，不能直接确认进入正式事实层。" });
        return;
      }
    }

    const nextOutput: ProfileBuilderOutput = {
      ...output,
      experiences: output.experiences.map((experience) => ({
        ...experience,
        facts: experience.facts.map((fact) =>
          fact.id === factId
            ? {
                ...fact,
                confirmedByUser: checked,
                needsConfirmation: !checked
              }
            : fact
        )
      })),
      skills: output.skills.map((skill) =>
        skill.id === factId
          ? {
              ...skill,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : skill
      ),
      certificates: output.certificates.map((certificate) =>
        certificate.id === factId
          ? {
              ...certificate,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : certificate
      )
    };

    const saved = await saveDraft({
      ...draft,
      status: draft.status === "ai_validated" ? "editing" : draft.status,
      builderOutput: draft.builderOutput ? nextOutput : draft.builderOutput,
      manualSections: draft.manualSections ? nextOutput : draft.manualSections
    });
    setDraft(saved);
  }

  async function commitProfile() {
    if (!draft || !rawInput) {
      return;
    }

    if (rawInput.kind === "resume_pdf_text" && workspace.status === "ready" && workspace.profiles.length > 0 && !draft.committedProfileId) {
      setSaveStatus("failed");
      notify({ type: "warning", title: "需手动合并", message: "已有个人资料时，PDF 导入结果会先保留为草稿，请在上方资料库中手动核对并合并。" });
      return;
    }

    try {
      setSaveStatus("saving");
      const profile = mapProfileDraftToCareerProfile({ draft, rawInput });
      const result = await repository.commitProfileDraft({
        draftId: draft.id,
        expectedRevision: draft.revision,
        commitId: `commit-profile-${draft.id}`,
        profile
      });
      setDraft({
        ...draft,
        status: "committed",
        revision: draft.revision + (result.idempotent ? 0 : 1),
        committedProfileId: result.profile.id,
        committedAt: new Date().toISOString()
      });
      setProfileOverride(result.profile);
      setProfileOverrides((current) => ({ ...current, [result.profile.id]: result.profile }));
      if (result.profile.personId) await repository.setActiveCareerContext({ personId: result.profile.personId, profileId: result.profile.id });
      if (rawInput.sourceSessionId) {
        const session = await repository.getPdfImportSession(rawInput.sourceSessionId);
        if (session) {
          const savedSession = await repository.updatePdfImportSession({
            ...session,
            status: "committed",
            committedProfileId: result.profile.id,
            committedAt: new Date().toISOString()
          });
          setPdfSession(savedSession);
        }
      }
      setSaveStatus("saved");
      notify({ type: "success", title: "已写入资料", message: `已写入个人资料：${result.profile.name}` });
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      notify({ type: "error", title: "提交失败", message: error instanceof RevisionConflictError ? "草稿版本已变化，请刷新后重试。" : "请检查已确认事实，低置信度或未定位来源不会进入个人资料。" });
    }
  }

  async function saveDraft(nextDraft: ProfileImportDraft) {
    setSaveStatus("saving");
    try {
      const saved = await repository.saveProfileImportDraftRevision(nextDraft, nextDraft.revision);
      setSaveStatus("saved");
      return saved;
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      throw error;
    }
  }

  if (workspace.status === "loading" || !loadedDraft) {
    return (
      <main className="page-shell">
        <WorkspaceLoadingState />
      </main>
    );
  }

  if (workspace.status === "error") {
    return (
      <main className="page-shell">
        <WorkspaceErrorState message={workspace.error} />
      </main>
    );
  }

  return (
    <main
      className={importWorkspaceOpen ? "page-shell profile-workspace is-import-open" : "page-shell profile-workspace"}
      {...(profileContentIntegrity ? { "data-profile-content-integrity": JSON.stringify(profileContentIntegrity) } : {})}
    >
      <ProductTopbar
        className="profile-page-topbar"
        title="个人资料库"
        status={profile ? `${profile.name} · ${profileCountSummary(profileCounts!)} · 本地已保存` : "未选择人物"}
      />

      <CareerContextEntryBar
        variant="profile"
        onImport={() => setImportWorkspaceOpen(true)}
        onExport={() => {
          setImportWorkspaceOpen(false);
          void exportCurrentProfileJson();
        }}
      />

      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}

      {profile ? (
        <>
        <section className="profile-manager-grid" ref={managerRef}>
          <article className="panel profile-category-panel">
            <div className="section-heading compact-heading">
              <div>
                <h2>资料分类</h2>
                <p>按类别管理可复用事实。</p>
              </div>
              <div className="action-row profile-detail-actions">
                <span className={`save-status save-status-${saveStatus}`}>{profileSaving ? "保存中" : "本地已保存"}</span>
              </div>
            </div>
            <div className="profile-category-list" role="listbox" aria-label="资料分类">
              {profileCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  data-profile-category={category.id}
                  data-section-type={category.sectionType}
                  className={activeProfileCategory === category.id ? "profile-category-button profile-category-button-active" : "profile-category-button"}
                  onClick={() => selectProfileCategory(category.id)}
                >
                  <span className="profile-category-icon" aria-hidden="true">
                    {(() => {
                      const Icon = profileCategoryIcons[category.id];
                      return <Icon />;
                    })()}
                  </span>
                  <span className="profile-category-copy">
                    <strong>{category.label}</strong>
                    <small>{category.description}</small>
                  </span>
                  <b>{profileCategoryCounts.get(category.id) ?? 0}</b>
                </button>
              ))}
            </div>
          </article>

          <article className="panel profile-list-panel">
            <div className="section-heading compact-heading">
              <div>
                <h2>{profileCategoryLabel(activeProfileCategory)}</h2>
                <p>只显示当前分类，列表和详情各自滚动。</p>
              </div>
              <div className="profile-list-actions">
                <button className="primary-button compact" disabled={profileSaving} onClick={startManagedProfileCreate}>新增</button>
                {activeProfileCategory !== "basics" && activeProfileCategory !== "summary" ? (
                  <button
                    className={batchMode ? "secondary-button compact" : "section-action-button compact"}
                    onClick={() => { setBatchMode(!batchMode); setSelectedBatchKeys(new Set()); }}
                  >
                    {batchMode ? "退出批量" : "批量删除"}
                  </button>
                ) : null}
                {batchMode && selectedBatchKeys.size > 0 ? (
                  <button className="section-action-button section-action-button-danger compact" onClick={() => { void batchTrashItems(); }}>
                    删除选中 ({selectedBatchKeys.size})
                  </button>
                ) : null}
              </div>
            </div>
            <div className="form-grid compact-form-grid">
              <label className="field-label profile-search-field">
                <span className="visually-hidden">搜索</span>
                <Search aria-hidden="true" />
                <input value={profileSearch} onChange={(event) => setProfileSearch(event.target.value)} placeholder="按名称、来源或内容筛选" />
              </label>
              <label className="field-label">
                使用状态
                <select value={profileUsageFilter} onChange={(event) => setProfileUsageFilter(event.target.value as ProfileUsageFilter)}>
                  <option value="all">全部当前条目</option>
                  <option value="used">已被使用</option>
                  <option value="unused">未被使用</option>
                  <option value="archived">已归档</option>
                </select>
              </label>
            </div>
            <div className="profile-managed-list" data-testid="profile-managed-list">
              {profileManagedItems.map((item) => (
                <div
                  key={item.key}
                  className={selectedProfileItem?.key === item.key ? "profile-managed-row profile-managed-row-active" : "profile-managed-row"}
                  onClick={() => batchMode && item.kind !== "basic" && item.kind !== "summary" ? toggleBatchItem(item.key) : selectManagedProfileItem(item)}
                >
                  {batchMode && item.kind !== "basic" && item.kind !== "summary" ? (
                    <input
                      type="checkbox"
                      className="batch-checkbox"
                      checked={selectedBatchKeys.has(item.key)}
                      onChange={() => toggleBatchItem(item.key)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : null}
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle || item.body || "暂无补充说明"}</small>
                  </span>
                  <div className="profile-managed-row-actions">
                    <em>{item.archived ? "已归档" : item.used ? "已使用" : "未使用"}</em>
                    {item.kind !== "basic" && item.kind !== "summary" ? (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          title="编辑"
                          aria-label={`编辑 ${item.title}`}
                          onClick={(e) => { e.stopPropagation(); setSelectedProfileItemKey(item.key); setProfileItemDraft(profileDraftFromItem(item)); setProfileItemEditing(true); }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 3l4 4L7.5 20.5 2 22l1.5-5.5L17 3z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                        {!item.archived ? (
                          <button
                            type="button"
                            className="icon-button"
                            title="归档"
                            aria-label={`归档 ${item.title}`}
                            onClick={(e) => { e.stopPropagation(); void archiveManagedProfileItem(item); }}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 8v13H3V8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 3h22v5H1z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 12h4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="icon-button"
                            title="恢复"
                            aria-label={`恢复 ${item.title}`}
                            onClick={(e) => { e.stopPropagation(); void restoreManagedProfileItem(item); }}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button icon-button-danger"
                          title="删除"
                          aria-label={`删除 ${item.title}`}
                          onClick={(e) => { e.stopPropagation(); void trashManagedProfileItem(item); }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {profileManagedItems.length === 0 ? (
                <div className="profile-empty-list">
                  <strong>当前筛选下没有条目</strong>
                  <p>{activeProfileCategory === "basics" ? "基本信息始终在右侧维护。" : "可以新建当前分类条目，或切换到已归档筛选恢复内容。"}</p>
                </div>
              ) : null}
            </div>
          </article>

          <article className="panel profile-detail-panel">
            <div className="section-heading compact-heading">
              <div>
                <h2>详情</h2>
                <p>{selectedProfileItem?.archived ? "归档条目可恢复到当前资料。" : "查看来源、使用状态和可编辑字段。"}</p>
              </div>
              {activeProfileCategory !== "basics" && selectedProfileItem ? (
                <div className="action-row profile-detail-actions">
                  {selectedProfileItem.archived ? (
                    <>
                      <button className="primary-button compact" disabled={profileSaving} onClick={() => { void restoreManagedProfileItem(selectedProfileItem); }}>恢复</button>
                      <button className="danger-button compact" disabled={profileSaving} onClick={() => { void trashManagedProfileItem(selectedProfileItem); }}>删除</button>
                    </>
                  ) : activeProfileCategory === "summary" ? (
                    <button className="secondary-button compact" disabled={profileSaving} onClick={startManagedProfileEdit}>编辑</button>
                  ) : (
                    <>
                      <button className="secondary-button compact" disabled={profileSaving} onClick={startManagedProfileEdit}>编辑</button>
                      <button className="secondary-button compact" disabled={profileSaving} onClick={() => { void archiveManagedProfileItem(selectedProfileItem); }}>归档</button>
                      <button className="danger-button compact" disabled={profileSaving} onClick={() => { void trashManagedProfileItem(selectedProfileItem); }}>删除</button>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {activeProfileCategory === "basics" && creatingNewProfile ? (
              <div className="profile-detail-scroll profile-detail-form">
                <div className="profile-new-person-note">
                  <strong>新增人物</strong>
                  <span>只保存你在此填写的信息，不会复制当前人物内容。</span>
                </div>
                <div className="section-fields-grid-2">
                  <FieldInput id="new-profile-name" label="姓名" required autoComplete="name" value={newProfileDraft.name} onChange={(name) => setNewProfileDraft((current) => ({ ...current, name }))} />
                  <FieldInput id="new-profile-headline" label="职业标题" value={newProfileDraft.headline} onChange={(headline) => setNewProfileDraft((current) => ({ ...current, headline }))} />
                </div>
                <div className="section-fields-grid-2">
                  <FieldInput id="new-profile-phone" label="电话" type="tel" inputMode="tel" autoComplete="tel" value={newProfileDraft.phone} onChange={(phone) => setNewProfileDraft((current) => ({ ...current, phone }))} />
                  <FieldInput id="new-profile-email" label="邮箱" type="email" inputMode="email" autoComplete="email" value={newProfileDraft.email} onChange={(email) => setNewProfileDraft((current) => ({ ...current, email }))} />
                </div>
                <FieldInput id="new-profile-location" label="所在地" autoComplete="address-level2" value={newProfileDraft.location} onChange={(location) => setNewProfileDraft((current) => ({ ...current, location }))} />
                <FieldInput id="new-profile-link" label="个人主页 / LinkedIn" type="url" inputMode="url" autoComplete="url" value={newProfileDraft.link} onChange={(link) => setNewProfileDraft((current) => ({ ...current, link }))} />
                <div className="action-row profile-detail-actions">
                  <button className="primary-button" disabled={profileSaving} onClick={() => { void saveNewProfile(); }}>创建人物</button>
                  <button className="secondary-button" disabled={profileSaving} onClick={() => { setProfileItemEditing(false); setSelectedProfileItemKey("basic:profile"); }}>取消</button>
                </div>
              </div>
            ) : activeProfileCategory === "basics" ? (
              <div className="profile-detail-scroll profile-detail-form">
                <div className="section-fields-grid-2">
                  <FieldInput id="profile-name" label="姓名" required autoComplete="name" value={basicDraft.name} onChange={(name) => setBasicDraft({ ...basicDraft, name })} />
                  <FieldInput id="profile-headline" label="职业标题" value={basicDraft.headline} onChange={(headline) => setBasicDraft({ ...basicDraft, headline })} />
                </div>
                <div className="section-fields-grid-2">
                  <FieldInput id="profile-phone" label="电话" type="tel" inputMode="tel" autoComplete="tel" value={basicDraft.phone} onChange={(phone) => setBasicDraft({ ...basicDraft, phone })} />
                  <FieldInput id="profile-email" label="邮箱" type="email" inputMode="email" autoComplete="email" value={basicDraft.email} onChange={(email) => setBasicDraft({ ...basicDraft, email })} />
                </div>
                <FieldInput id="profile-location" label="所在地" autoComplete="address-level2" value={basicDraft.location} onChange={(location) => setBasicDraft({ ...basicDraft, location })} />
                <FieldInput id="profile-link" label="个人主页 / LinkedIn" type="url" inputMode="url" autoComplete="url" value={basicDraft.link} onChange={(link) => setBasicDraft({ ...basicDraft, link })} />
                <button className="primary-button" disabled={profileSaving} onClick={saveProfileBasics}>保存基本信息</button>
              </div>
            ) : profileItemEditing ? (
              <div className="profile-detail-scroll profile-detail-form">
                {creatingNewProfile && activeProfileCategory === "summary" ? (
                  <>
                    <div className="profile-new-person-note">
                      <strong>新增人物与自我评价</strong>
                      <span>姓名用于建立独立人物资料，自我评价不会覆盖当前人物。</span>
                    </div>
                    <FieldInput id="new-summary-profile-name" label="姓名" required autoComplete="name" value={newProfileDraft.name} onChange={(name) => setNewProfileDraft((current) => ({ ...current, name }))} />
                    <label className="field-input-group">
                      <span className="field-input-label">自我评价</span>
                      <textarea className="textarea compact-textarea" value={newProfileDraft.summary} onChange={(event) => setNewProfileDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="概括职业方向、优势和与目标岗位有关的能力" />
                    </label>
                  </>
                ) : (
                  <ProfileCategoryFields category={activeProfileCategory} draft={profileItemDraft} onChange={setProfileItemDraft} />
                )}
                <div className="action-row profile-detail-actions">
                  <button className="primary-button" disabled={profileSaving} onClick={() => { void (creatingNewProfile ? saveNewProfile() : saveManagedProfileItem()); }}>{creatingNewProfile ? "创建人物" : "保存"}</button>
                  <button className="secondary-button" disabled={profileSaving} onClick={() => { setProfileItemEditing(false); setSelectedProfileItemKey(profileManagedItems[0]?.key ?? `new:${activeProfileCategory}`); }}>取消</button>
                </div>
              </div>
            ) : selectedProfileItem ? (
              <div className="profile-detail-scroll">
                <dl className="profile-detail-data-list">
                  {profileDetailRows(selectedProfileItem).map((row) => (
                    <div key={row.label}><dt>{row.label}</dt><dd>{row.value || "—"}</dd></div>
                  ))}
                </dl>
                <div className="profile-source-list">
                  <strong>事实说明</strong>
                  <p>{selectedProfileItem.body || selectedProfileItem.subtitle || "暂无说明。"}</p>
                </div>
                <div className="profile-source-list">
                  <strong>关联简历</strong>
                  <p>{selectedProfileItem.used ? "已有简历草稿或事实引用使用该条目。" : "当前没有明确关联的简历草稿。"}</p>
                </div>
              </div>
            ) : (
              <div className="profile-empty-list">
                <strong>请选择一个条目</strong>
                <p>左侧切换分类，中间选择条目后在这里查看或编辑。</p>
              </div>
            )}
          </article>
        </section>
        </>
      ) : (
        <section className="panel">
          <h2>还没有个人资料</h2>
          <p>可以粘贴已有简历文本或导入文本型 PDF，核对后生成第一份个人资料。</p>
        </section>
      )}

      <section className="stage-grid">
        {importMode === "paste" ? (
          <article className="panel">
            <h2>1. 粘贴简历文本</h2>
            <textarea
              data-testid="profile-raw-textarea"
              className="textarea"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="粘贴简历、经历清单或已有简历文本..."
            />
            <div className="action-row">
              <button className="secondary-button" data-testid="profile-import-paste-mode" onClick={() => setImportMode("paste")}>
                粘贴文本
              </button>
              <button className="secondary-button" data-testid="profile-import-pdf-mode" onClick={() => setImportMode("pdf")}>
                导入文本型 PDF
              </button>
              <button className="primary-button" data-testid="save-profile-raw-input" onClick={startImport}>
                保存原文
              </button>
              <span className={`save-status save-status-${saveStatus}`}>保存状态：{saveStatusLabel(saveStatus)}</span>
            </div>
          </article>
        ) : null}

        {importMode === "pdf" ? (
          <article className="panel">
            <h2>1. 文本型 PDF 导入</h2>
            <p>PDF 会在浏览器本地提取文本；隐私确认前不会发送给外部模型，也不会长期保存原始 PDF 文件。</p>
            <input id={pdfInputId} type="file" accept="application/pdf,.pdf" onChange={handlePdfFileChange} />
            <div className="action-row">
              <button className="secondary-button" data-testid="profile-import-paste-mode" onClick={() => setImportMode("paste")}>
                粘贴文本
              </button>
              <button className="secondary-button" data-testid="profile-import-pdf-mode" onClick={() => setImportMode("pdf")}>
                导入文本型 PDF
              </button>
              {pdfStatus === "extracting" ? (
                <button className="secondary-button" onClick={cancelPdfExtraction}>
                  取消提取
                </button>
              ) : null}
              {pdfSession ? (
                <button className="secondary-button" onClick={deleteCurrentPdfSession}>
                  删除导入记录
                </button>
              ) : null}
              {pdfText.trim().length > 0 ? (
                <button className="primary-button" data-testid="profile-start-pdf-draft" onClick={startPdfDraft}>
                  使用提取文本创建草稿
                </button>
              ) : null}
              {pdfText.trim().length > 0 ? (
                <button className="secondary-button" onClick={() => {
                  setImportMode("paste");
                  setRawText(pdfText);
                }}>
                  转为粘贴文本编辑
                </button>
              ) : null}
            </div>
            <p className={`save-status save-status-${pdfStatus === "failed" ? "failed" : "saved"}`}>PDF 状态：{pdfSession?.status ?? pdfStatus}</p>
            {pdfSession ? (
              <div className="warning-box">
                <strong>{pdfSession.fileName}</strong>
                <p>{pdfSession.pageCount} 页 / {pdfSession.textLength} 字 / 文件指纹 {pdfSession.fileHash.slice(0, 12)}</p>
                {pdfSession.normalizedTextHash ? <p>文本指纹 {pdfSession.normalizedTextHash.slice(0, 12)} / 识别文本指纹 {pdfSession.aiInputHash?.slice(0, 12) ?? "待确认"}</p> : null}
                {pdfSession.warnings.length > 0 ? <p>提示：{formatPdfWarnings(pdfSession.warnings).join(" / ")}</p> : null}
                {pdfSession.errorMessage ? <p>{pdfSession.errorMessage}</p> : null}
              </div>
            ) : null}
            {pdfHasPromptInjectionRisk ? (
              <div className="warning-box">检测到类似 SYSTEM、忽略规则或编造经历的文字。系统只把它当作 PDF 内容，不会执行其中指令。</div>
            ) : null}
            {pdfPages.length > 0 ? (
              <div className="timeline">
                {pdfPages.map((page) => (
                  <article key={page.id}>
                    <h3>第 {page.pageNumber} 页</h3>
                    <p>{page.cleanedPageText.slice(0, 260)}</p>
                    <small>原始文本已保留用于核对；清洗文本用于生成草稿；低文本密度会提示 OCR 后置。</small>
                  </article>
                ))}
              </div>
            ) : null}
            {pdfText.trim().length > 0 ? (
              <div>
                <h3>实际 AI 输入文本</h3>
                <textarea
                  className="textarea"
                  value={userEditedAiText}
                  onChange={(event) => handlePdfAiInputChange(event.target.value)}
                />
                <small>保持原样时使用确定性清洗文本；修改后会标记为用户编辑 AI 输入，必须重新确认隐私。</small>
              </div>
            ) : null}
          </article>
        ) : null}

        {draft?.status === "privacy_pending" ? (
          <article className="panel">
            <h2>2. 外部模型与隐私说明</h2>
            <p>系统会在服务端默认脱敏手机号、邮箱、身份证号和精确地址后，再发送给外部模型。</p>
            <p>本次识别文本指纹：{rawInput?.aiInputHash?.slice(0, 16) ?? rawInput?.inputHash.slice(0, 16)}</p>
            <p>本次脱敏预览：{redactionPreview.redactions.length === 0 ? "未发现需脱敏内容" : redactionPreview.redactions.map((item) => `${item.type} x${item.count}`).join(" / ")}</p>
            <div className="action-row">
              <button className="primary-button" data-testid="profile-analyze-ai" onClick={analyzeWithAi}>
                同意脱敏并解析
              </button>
              <button className="secondary-button" data-testid="profile-manual-mode" onClick={enterManualMode}>
                拒绝，手动分类
              </button>
            </div>
          </article>
        ) : null}
      </section>

      {output ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>解析草稿与原文依据</h2>
              <p>只勾选你确认属实的事实；未定位原文的低置信度内容不会进入个人资料。</p>
            </div>
            <button className="primary-button" data-testid="commit-profile" onClick={commitProfile}>
              写入个人资料
            </button>
          </div>
          <div className="timeline">
            {output.experiences.map((experience) => (
              <article key={experience.id}>
                <h3>{experience.organization.value} / {experience.role.value}</h3>
                {experience.facts.map((fact) => (
                  <FactReviewRow key={fact.id} fact={fact} requirePdfLocation={rawInput?.kind === "resume_pdf_text"} onToggle={toggleFact} />
                ))}
              </article>
            ))}
          </div>
          {output.unclassifiedBlocks.length > 0 ? (
            <div className="warning-box">
              <strong>未分类内容</strong>
              {output.unclassifiedBlocks.map((block) => (
                <p key={block}>{block}</p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel current-profile-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>当前个人资料</h2>
            <p>这是资料库当前使用的个人档案。</p>
          </div>
          {profile ? (
            <div className="action-row current-profile-actions">
              <button type="button" className="secondary-button compact" onClick={editCurrentProfile}>修改</button>
              <button type="button" className="danger-button compact" onClick={() => { void requestCurrentProfileDelete(); }}>删除</button>
            </div>
          ) : null}
        </div>
        {profile ? (
          <div className="timeline">
            <article>
              <h3>{profile.name}</h3>
              <p>{profile.basics.summary}</p>
              <p>{profile.experiences.length} 段经历 / {profile.skills.length} 项技能</p>
            </article>
          </div>
        ) : (
          <p>暂无个人资料。</p>
        )}
      </section>

      {blockerDialogOpen && profile && blockers ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="blocker-dialog-title">
          <div className="sync-dialog profile-delete-dialog">
            <h3 className="sync-dialog-title" id="blocker-dialog-title">删除前需清理关联数据</h3>
            <p className="sync-dialog-description">“{profile.name}”仍被以下数据引用，需要先清理才能删除。</p>
            <div className="blocker-category-list">
              {([
                { key: "branches" as const, label: "简历草稿", unit: "份" },
                { key: "applications" as const, label: "求职记录", unit: "条" },
                { key: "matches" as const, label: "岗位匹配记录", unit: "条" },
                { key: "matchOperations" as const, label: "匹配操作记录", unit: "条" },
                { key: "adaptationDrafts" as const, label: "适配草稿", unit: "份" },
                { key: "commits" as const, label: "提交记录", unit: "条" }
              ]).map(({ key, label, unit }) => {
                const count = blockers[key];
                return (
                  <div key={key} className="blocker-category-row">
                    <span className="blocker-category-label">{label}</span>
                    <span className="blocker-category-count">{count} {unit}</span>
                    {count > 0 ? (
                      <button
                        type="button"
                        className="danger-button compact"
                        disabled={clearingCategory !== null}
                        onClick={() => { void clearBlockerCategory(key); }}
                      >
                        {clearingCategory === key ? "清理中…" : "清理"}
                      </button>
                    ) : (
                      <span className="blocker-category-done">✓</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="sync-dialog-actions">
              <button type="button" className="secondary-button" disabled={clearingCategory !== null} onClick={() => setBlockerDialogOpen(false)}>取消</button>
              <button type="button" className="secondary-button" disabled={clearingCategory !== null} onClick={() => { void clearAllBlockers(); }}>
                {clearingCategory === "all" ? "清理中…" : "全部清理"}
              </button>
              <button type="button" className="danger-button" disabled={profileDeleting} onClick={() => { void forceDeleteProfile(); }}>
                {profileDeleting ? "删除中…" : "强制删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileDeleteOpen && profile ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-delete-title">
          <div className="sync-dialog profile-delete-dialog">
            <h3 className="sync-dialog-title" id="profile-delete-title">删除当前个人资料？</h3>
            <p className="sync-dialog-description">此操作会删除“{profile.name}”及其中的经历、技能和证书，且无法撤销。导入草稿不会随之删除。</p>
            <div className="sync-dialog-actions">
              <button type="button" className="section-action-button" disabled={profileDeleting} onClick={() => setProfileDeleteOpen(false)}>取消</button>
              <button type="button" className="danger-button" disabled={profileDeleting} onClick={() => { void confirmCurrentProfileDelete(); }}>
                {profileDeleting ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {forceDeleteDialog ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="force-delete-title">
          <div className="sync-dialog profile-delete-dialog">
            <h3 className="sync-dialog-title" id="force-delete-title">强制删除条目？</h3>
            <p className="sync-dialog-description">
              “{forceDeleteDialog.item.title}”仍被 {forceDeleteDialog.referenceCount} 份简历引用。
              强制删除后，简历中引用该条目的内容会被同步移除。
            </p>
            <div className="sync-dialog-actions">
              <button type="button" className="section-action-button" onClick={() => setForceDeleteDialog(null)}>取消</button>
              <button type="button" className="section-action-button section-action-button-danger" onClick={() => { void confirmForceTrashItem(); }}>
                确认强制删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export function ProfileCategoryFields({
  category,
  draft,
  onChange
}: {
  category: ProfileCategoryId;
  draft: ProfileItemDraft;
  onChange: (draft: ProfileItemDraft) => void;
}) {
  const update = <Key extends keyof ProfileItemDraft>(key: Key, value: ProfileItemDraft[Key]) => onChange({ ...draft, [key]: value });
  if (category === "summary") {
    return (
      <label className="field-input-group">
        <span className="field-input-label">自我评价</span>
        <textarea className="textarea compact-textarea" value={draft.body} onChange={(event) => update("body", event.target.value)} placeholder="概括职业方向、优势和与目标岗位有关的能力" />
      </label>
    );
  }
  if (category === "project") {
    return (
      <StructuredProjectForm
        value={draft.projectFields}
        onChange={(value) => onChange({
          ...draft,
          projectFields: value,
          organization: value.title,
          role: value.role,
          location: value.location,
          startDate: value.startDate,
          endDate: value.endDate,
          current: value.current,
          description: value.description,
          highlights: value.highlights,
          body: value.description
        })}
        idPrefix="profile-project"
      />
    );
  }
  if (category === "education" || category === "work" || category === "internship" || category === "campus") {
    const extraField = category === "work" ? (
      <label className="field-input-group">
        <span className="field-input-label">经历类型</span>
        <select className="field-input" value={draft.experienceType} onChange={(event) => update("experienceType", event.target.value as ExperienceType)}>
          <option value="work">工作</option>
          <option value="internship">实习</option>
        </select>
      </label>
    ) : undefined;
    return (
      <StructuredExperienceForm
        category={category}
        value={draft}
        onChange={(value) => onChange({ ...draft, ...value })}
        idPrefix={`profile-${category}`}
        extraField={extraField}
      />
    );
  }
  if (category === "basics") return null;

  const labels: Partial<Record<ProfileCategoryId, { title: string; subtitle: string; body: string }>> = {
    award: { title: "奖项名称", subtitle: "颁发机构 / 赛事", body: "获奖说明" },
    certificate: { title: "证书名称", subtitle: "颁发机构", body: "证书说明" },
    skill: { title: "技能名称", subtitle: "技能方向", body: "使用场景或能力说明" },
    language: { title: "语言", subtitle: "考试 / 证书", body: "语言能力说明" },
    custom: { title: "内容标题", subtitle: "栏目名称", body: "详细内容" }
  };
  const currentLabels = labels[category] ?? { title: "名称", subtitle: "补充信息", body: "详细内容" };
  return (
    <div className="section-fields">
      <div className="section-fields-grid-2">
        <FieldInput id={`profile-${category}-title`} label={currentLabels.title} required={category !== "custom"} value={draft.title} onChange={(value) => update("title", value)} />
        <FieldInput id={`profile-${category}-subtitle`} label={currentLabels.subtitle} value={draft.subtitle} onChange={(value) => update("subtitle", value)} />
      </div>
      {category === "award" || category === "certificate" ? (
        <FieldInput id={`profile-${category}-date`} label={category === "award" ? "获奖月份" : "颁发日期"} type={category === "award" ? "month" : "date"} value={draft.date} onChange={(value) => update("date", value)} />
      ) : null}
      {category === "skill" || category === "language" ? (
        <label className="field-input-group">
          <span className="field-input-label">熟练度</span>
          <select className="field-input" value={draft.level} onChange={(event) => update("level", event.target.value as Skill["level"])}>
            <option value="basic">了解</option>
            <option value="familiar">熟悉</option>
            <option value="proficient">熟练</option>
          </select>
        </label>
      ) : null}
      <label className="field-input-group">
        <span className="field-input-label">{currentLabels.body}</span>
        <textarea className="textarea compact-textarea" value={draft.body} onChange={(event) => update("body", event.target.value)} />
      </label>
    </div>
  );
}

function profileDetailRows(item: ProfileManagedItem): Array<{ label: string; value: string }> {
  const structured = item.structured;
  const rows: Array<{ label: string; value: string }> = [];
  if (structured) {
    const organizationLabel = item.category === "education" ? "学校名称"
      : item.category === "project" ? "项目名称"
        : item.category === "campus" ? "组织 / 活动" : "公司 / 组织";
    const roleLabel = item.category === "education" ? "学历"
      : item.category === "project" ? "职责 / 角色"
        : item.category === "campus" ? "职务 / 角色" : "职位 / 角色";
    rows.push({ label: organizationLabel, value: structured.organization });
    rows.push({ label: roleLabel, value: item.category === "education" ? structured.degree : structured.role });
    if (item.category === "education") rows.push({ label: "专业", value: structured.major });
    rows.push({ label: item.category === "education" ? "学校所在地" : "地点", value: structured.location });
    rows.push({ label: "开始时间", value: structured.startDate });
    rows.push({ label: "结束时间", value: structured.current ? "至今" : structured.endDate });
    if (item.category === "education") rows.push({ label: "主修课程", value: structured.courses });
  } else {
    rows.push({ label: item.category === "summary" ? "栏目" : "名称", value: item.title });
    if (item.subtitle) rows.push({ label: "补充信息", value: item.subtitle });
    if (item.date) rows.push({ label: item.category === "award" ? "获奖月份" : "日期", value: item.date });
  }
  rows.push({ label: "分类", value: profileCategoryLabel(item.category) });
  rows.push({ label: "来源", value: item.source });
  rows.push({ label: "使用状态", value: item.usage });
  rows.push({ label: "更新时间", value: item.updatedAt.slice(0, 10) });
  return rows;
}

function buildProfileManagedItems(
  profile: CareerProfile,
  archive: ProfileArchiveState,
  category: ProfileCategoryId,
  search: string,
  usageFilter: ProfileUsageFilter
): ProfileManagedItem[] {
  const archived = usageFilter === "archived";
  const currentItems = archived ? [] : buildCurrentProfileItems(profile, category);
  const archivedItems = archived ? buildArchivedProfileItems(archive, category) : [];
  const searchText = search.trim().toLowerCase();
  return [...currentItems, ...archivedItems].filter((item) => {
    if (usageFilter === "used" && !item.used) {
      return false;
    }
    if (usageFilter === "unused" && item.used) {
      return false;
    }
    if (!searchText) {
      return true;
    }
    return [item.title, item.subtitle, item.body, item.source, item.usage]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  });
}

function buildCurrentProfileItems(profile: CareerProfile, category: ProfileCategoryId): ProfileManagedItem[] {
  const isV2 = profile.schemaVersion === "career-profile-v2" && Array.isArray(profile.structuredFacts);
  if (category === "basics") {
    const basics = canonicalProfileBasics(profile);
    return [{
      key: "basic:profile",
      id: profile.id,
      kind: "basic",
      category: "basics",
      title: basics.name ?? profile.basics.name,
      subtitle: [basics.email, basics.phone, basics.location].filter(Boolean).join(" / "),
      body: basics.summary ?? "",
      source: "用户确认",
      usage: "简历页眉使用",
      used: true,
      archived: false,
      updatedAt: profile.updatedAt
    }];
  }

  if (category === "summary") {
    const canonicalSummary = canonicalProfileLibraryItems(profile).find((item) => item.sectionType === "summary");
    return [{
      key: "summary:profile",
      id: profile.id,
      kind: "summary",
      category: "summary",
      title: "自我评价",
      subtitle: "用于简历概述，可在具体简历中独立修改",
      body: canonicalSummary?.body ?? canonicalProfileBasics(profile).summary ?? "",
      source: "用户确认",
      usage: canonicalSummary ? "已确认资料" : "待补充",
      used: Boolean(canonicalSummary),
      archived: false,
      updatedAt: profile.updatedAt
    }];
  }

  if (!isV2 && category === "certificate") {
    const certificates = profile.certificates.map((certificate) => certificateToManagedItem(certificate, false));
    if (certificates.length > 0) return certificates;
  }

  if (!isV2 && (category === "skill" || category === "language")) {
    const skills = profile.skills
      .filter((skill) => isLanguageSkill(skill) === (category === "language"))
      .map((skill) => skillToManagedItem(skill, category, false));
    if (skills.length > 0) return skills;
  }

  if (category === "custom") {
    const customBlocks: ProfileManagedItem[] = profile.unclassifiedBlocks.map((block, index) => ({
      key: `custom:current:${index}`,
      id: `custom:${index}`,
      kind: "custom",
      category: "custom",
      title: block.slice(0, 32) || "自定义内容",
      subtitle: "待分类内容",
      body: block,
      source: "用户确认",
      usage: "未进入正式分类",
      used: false,
      archived: false,
      updatedAt: profile.updatedAt
    }));
    if (customBlocks.length > 0) return customBlocks;
  }

  const legacyExperiences = isV2 ? [] : profile.experiences
    .filter((experience) => categoryForExperience(experience) === category)
    .map((experience) => experienceToManagedItem(experience, false));
  if (legacyExperiences.length > 0) return legacyExperiences;

  return canonicalProfileLibraryItems(profile)
    .filter((item) => profileCategoryForCanonicalSection(item.sectionType) === category)
    .map((item) => ({
      key: `canonical:${item.sectionType}:${item.id}`,
      id: item.id,
      kind: "canonical" as const,
      category,
      title: item.title,
      subtitle: item.subtitle,
      body: item.body,
      source: item.factIds.length ? "已确认事实" : "用户确认",
      usage: "可加入简历",
      used: true,
      archived: false,
      updatedAt: profile.updatedAt,
      canonicalData: item.data,
      structured: isStructuredCanonicalSection(item.data.sectionType) && item.data.sectionType !== "project"
        ? canonicalToStructuredExperienceFields(item.data)
        : undefined,
      projectStructured: item.data.sectionType === "project"
        ? canonicalToStructuredProjectFields(item.data)
        : undefined,
      date: canonicalItemDate(item.data)
    }));
}

function buildArchivedProfileItems(archive: ProfileArchiveState, category: ProfileCategoryId): ProfileManagedItem[] {
  if (category === "certificate") {
    return archive.certificates.map((certificate) => certificateToManagedItem(certificate, true));
  }
  if (category === "skill" || category === "language") {
    return archive.skills
      .filter((skill) => isLanguageSkill(skill) === (category === "language"))
      .map((skill) => skillToManagedItem(skill, category, true));
  }
  if (category === "custom") {
    return archive.customBlocks.map((block) => ({
      key: `custom:archived:${block.id}`,
      id: block.id,
      kind: "custom",
      category: "custom",
      title: block.text.slice(0, 32) || "自定义内容",
      subtitle: "已归档内容",
      body: block.text,
      source: "用户确认",
      usage: "已归档",
      used: false,
      archived: true,
      updatedAt: block.updatedAt
    }));
  }
  return archive.experiences
    .filter((experience) => categoryForExperience(experience) === category)
    .map((experience) => experienceToManagedItem(experience, true));
}

function buildProfileCategoryCounts(profile: CareerProfile, archive: ProfileArchiveState) {
  const canonicalCounts = canonicalProfileSectionCounts(profile);
  const counts = new Map<ProfileCategoryId, number>();
  for (const category of profileCategories) {
    const canonicalSectionId = canonicalSectionTypeForProfileCategory(category.id);
    const canonicalCount = canonicalSectionId ? canonicalCounts.get(canonicalSectionId) ?? 0 : 0;
    counts.set(category.id, canonicalCount + buildArchivedProfileItems(archive, category.id).length);
  }
  return counts;
}

function isStructuredCanonicalSection(sectionType: ResumeItemV2["sectionType"]) {
  return ["education", "work", "internship", "project", "campus", "volunteer"].includes(sectionType);
}

function canonicalItemDate(item: ResumeItemV2) {
  if (item.sectionType === "awards") return item.awardedAt ?? "";
  if (item.sectionType === "certificates") return item.issuedAt ?? "";
  if ("startDate" in item && typeof item.startDate === "string") return item.startDate;
  return "";
}

function patchCanonicalProfileDraft(item: ResumeItemV2, draft: ProfileItemDraft): ResumeItemV2 {
  if (item.sectionType === "project") {
    return patchCanonicalProjectFields(item, draft.projectFields);
  }
  if (isStructuredCanonicalSection(item.sectionType)) {
    return patchCanonicalExperienceFields(item, draft);
  }
  if (item.sectionType === "awards") {
    return {
      ...item,
      name: draft.title.trim(),
      issuer: optionalText(draft.subtitle),
      awardedAt: normalizeAwardedAt(draft.date),
      description: optionalText(draft.body)
    };
  }
  if (item.sectionType === "skills") {
    return {
      ...item,
      name: draft.title.trim(),
      category: optionalText(draft.subtitle),
      description: optionalText(draft.body)
    };
  }
  if (item.sectionType === "certificates") {
    return {
      ...item,
      name: draft.title.trim(),
      issuer: optionalText(draft.subtitle),
      issuedAt: optionalText(draft.date),
      description: optionalText(draft.body)
    };
  }
  if (item.sectionType === "languages") {
    return {
      ...item,
      language: draft.title.trim(),
      level: optionalText(draft.subtitle),
      description: optionalText(draft.body)
    };
  }
  return item;
}

function experienceToManagedItem(experience: Experience, archived: boolean): ProfileManagedItem {
  const firstFact = experience.facts[0];
  return {
    key: `experience:${archived ? "archived" : "current"}:${experience.id}`,
    id: experience.id,
    kind: "experience",
    category: categoryForExperience(experience),
    title: experience.organization,
    subtitle: experience.role,
    body: firstFact?.statement ?? "",
    source: firstFact?.provenance[0]?.sourceText ?? "用户确认",
    usage: experience.resumeDrafts.length > 0 ? `${experience.resumeDrafts.length} 个简历草稿` : "已确认事实",
    used: experience.resumeDrafts.length > 0 || experience.facts.length > 0,
    archived,
    updatedAt: experience.updatedAt,
    experienceType: experience.type,
    date: [experience.startDate, experience.endDate].filter(Boolean).join(" - "),
    structured: {
      organization: experience.organization,
      role: experience.role,
      location: experience.location ?? "",
      degree: experience.degree ?? (experience.type === "education" ? experience.role : ""),
      major: experience.major ?? "",
      courses: (experience.courses ?? []).join("、"),
      startDate: experience.startDate ?? "",
      endDate: experience.endDate ?? "",
      current: Boolean(experience.startDate && !experience.endDate),
      description: firstFact?.statement ?? "",
      highlights: []
    },
    ...(categoryForExperience(experience) === "project" ? {
      projectStructured: {
        ...emptyStructuredProjectFields,
        title: experience.organization,
        role: experience.role,
        organization: "",
        location: experience.location ?? "",
        startDate: experience.startDate ?? "",
        endDate: experience.endDate ?? "",
        current: Boolean(experience.startDate && !experience.endDate),
        description: firstFact?.statement ?? ""
      }
    } : {})
  };
}

function certificateToManagedItem(certificate: Certificate, archived: boolean): ProfileManagedItem {
  return {
    key: `certificate:${archived ? "archived" : "current"}:${certificate.id}`,
    id: certificate.id,
    kind: "certificate",
    category: "certificate",
    title: certificate.name,
    subtitle: certificate.issuer ?? "",
    body: certificate.fact?.statement ?? certificate.name,
    source: certificate.fact?.provenance[0]?.sourceText ?? "用户确认",
    usage: certificate.fact ? "已确认事实" : "待补充事实",
    used: Boolean(certificate.fact || certificate.evidenceIds.length),
    archived,
    updatedAt: certificate.updatedAt,
    date: certificate.issuedAt
  };
}

function skillToManagedItem(skill: Skill, category: ProfileCategoryId, archived: boolean): ProfileManagedItem {
  return {
    key: `skill:${archived ? "archived" : "current"}:${skill.id}`,
    id: skill.id,
    kind: "skill",
    category,
    title: skill.name,
    subtitle: skillLevelLabel(skill.level),
    body: skill.fact?.statement ?? skill.name,
    source: skill.fact?.provenance[0]?.sourceText ?? "用户确认",
    usage: skill.fact ? "已确认事实" : "待补充事实",
    used: Boolean(skill.fact || skill.evidenceIds.length),
    archived,
    updatedAt: skill.updatedAt,
    skillLevel: skill.level
  };
}

function profileDraftFromItem(item: ProfileManagedItem): ProfileItemDraft {
  return {
    ...emptyStructuredExperienceFields,
    ...item.structured,
    projectFields: item.projectStructured ?? emptyStructuredProjectFields,
    title: item.title,
    subtitle: item.subtitle,
    body: item.body,
    date: item.category === "award" ? normalizeAwardedAt(item.date) ?? "" : item.date ?? "",
    level: item.skillLevel ?? "familiar",
    experienceType: item.experienceType ?? defaultExperienceTypeForCategory(item.category)
  };
}

function defaultProfileDraftForCategory(category: ProfileCategoryId): ProfileItemDraft {
  return {
    ...emptyProfileItemDraft,
    experienceType: defaultExperienceTypeForCategory(category)
  };
}

function buildExperienceFromDraft(draft: ProfileItemDraft, category: ProfileCategoryId, existingId: string | undefined, now: string): Experience {
  const id = existingId ?? `experience-${nanoid(10)}`;
  const type = category === "work" ? draft.experienceType : defaultExperienceTypeForCategory(category);
  const isStructured = category === "education" || category === "work" || category === "internship" || category === "project" || category === "campus";
  const organization = (isStructured ? draft.organization : draft.title).trim() || profileCategoryLabel(category);
  const role = (category === "education" ? draft.degree : isStructured ? draft.role : draft.subtitle).trim() || profileCategoryLabel(category);
  const statement = (isStructured ? draft.description : draft.body).trim() || `${organization} / ${role}`;
  return {
    id,
    type,
    organization,
    role,
    location: optionalText(draft.location),
    degree: category === "education" ? optionalText(draft.degree) : undefined,
    major: category === "education" ? optionalText(draft.major) : undefined,
    courses: category === "education" ? draft.courses.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : [],
    startDate: optionalText(draft.startDate),
    endDate: isStructured ? (draft.current ? undefined : optionalText(draft.endDate)) : optionalText(draft.date),
    facts: [buildUserFact(`fact-${nanoid(10)}`, id, statement, factCategoryForProfileCategory(category), now)],
    resumeDrafts: [],
    tags: category === "award" ? ["award"] : [],
    evidenceIds: [],
    createdAt: now,
    updatedAt: now
  };
}

function buildCertificateFromDraft(draft: ProfileItemDraft, existingId: string | undefined, now: string): Certificate {
  const id = existingId ?? `certificate-${nanoid(10)}`;
  const name = draft.title.trim();
  const statement = draft.body.trim() || name;
  return {
    id,
    name,
    issuer: optionalText(draft.subtitle),
    issuedAt: optionalText(draft.date),
    evidenceIds: [],
    fact: buildUserFact(`fact-${nanoid(10)}`, id, statement, "certificate", now),
    createdAt: now,
    updatedAt: now
  };
}

function buildSkillFromDraft(draft: ProfileItemDraft, category: ProfileCategoryId, existingId: string | undefined, now: string): Skill {
  const factCategory: FactCategory = category === "language" ? "language" : "skill";
  const skill = buildUserSkill(draft.title.trim(), draft.level, now, factCategory, existingId);
  return {
    ...skill,
    fact: buildUserFact(`fact-${nanoid(10)}`, skill.id, draft.body.trim() || skill.fact?.statement || skill.name, factCategory, now)
  };
}

function buildUserFact(id: string, sourceId: string, statement: string, category: FactCategory, now: string): Experience["facts"][number] {
  return {
    id,
    statement,
    category,
    confirmedByUser: true,
    riskLevel: "low",
    provenance: [{
      sourceType: "user_input",
      sourceId,
      sourceText: statement,
      confidence: 1,
      confirmedByUser: true,
      riskLevel: "low",
      createdAt: now
    }],
    createdAt: now,
    updatedAt: now
  };
}

function parseProfileArchive(value: unknown, legacySkills: Skill[]): ProfileArchiveState {
  if (!value || typeof value !== "object") {
    return { ...emptyProfileArchive, skills: legacySkills };
  }
  const record = value as Partial<ProfileArchiveState>;
  return {
    experiences: Array.isArray(record.experiences) ? record.experiences : [],
    certificates: Array.isArray(record.certificates) ? record.certificates : [],
    skills: Array.isArray(record.skills) ? record.skills : legacySkills,
    customBlocks: Array.isArray(record.customBlocks) ? record.customBlocks : []
  };
}

function categoryForExperience(experience: Experience): ProfileCategoryId {
  if (experience.type === "education") {
    return "education";
  }
  if (experience.type === "work" || experience.type === "internship") {
    return "work";
  }
  if (experience.type === "project") {
    return "project";
  }
  if (experience.type === "campus" || experience.type === "volunteer") {
    return "campus";
  }
  if (experience.type === "competition") {
    return "award";
  }
  return "custom";
}

function defaultExperienceTypeForCategory(category: ProfileCategoryId): ExperienceType {
  return defaultExperienceType(category as Parameters<typeof defaultExperienceType>[0]);
}

function isStructuredProfileCategory(category: ProfileCategoryId): category is "education" | "work" | "internship" | "project" | "campus" {
  return category === "education" || category === "work" || category === "internship" || category === "project" || category === "campus";
}

function buildCanonicalProfileItemFromDraft(draft: ProfileItemDraft, category: "education" | "work" | "internship" | "project" | "campus"): ResumeItemV2 {
  const id = `profile-${category}-${nanoid(10)}`;
  const project = draft.projectFields;
  const shared = {
    id,
    customFields: [],
    startDate: optionalText(draft.startDate),
    endDate: draft.current ? undefined : optionalText(draft.endDate),
    current: draft.current,
    location: optionalText(draft.location),
    description: optionalText(draft.description),
    highlights: draft.highlights.map((value) => value.trim()).filter(Boolean)
  };
  if (category === "education") {
    return ResumeItemV2Schema.parse({
      ...shared,
      sectionType: "education",
      school: optionalText(draft.organization),
      degree: optionalText(draft.degree || draft.role),
      major: optionalText(draft.major),
      courses: draft.courses.split(/[、,，;；]/).map((value) => value.trim()).filter(Boolean),
      honors: []
    });
  }
  if (category === "project") {
    return ResumeItemV2Schema.parse({
      id,
      sectionType: "project",
      title: optionalText(project.title),
      role: optionalText(project.role),
      organization: optionalText(project.organization),
      location: optionalText(project.location),
      startDate: optionalText(project.startDate),
      endDate: project.current ? undefined : optionalText(project.endDate),
      current: project.current,
      url: optionalText(project.url),
      tools: project.tools.map((value) => value.trim()).filter(Boolean),
      background: optionalText(project.background),
      description: optionalText(project.description),
      highlights: project.highlights.map((value) => value.trim()).filter(Boolean),
      outcomes: project.outcomes.map((value) => value.trim()).filter(Boolean),
      customFields: []
    });
  }
  return ResumeItemV2Schema.parse({
    ...shared,
    sectionType: category === "internship" || category === "work" && draft.experienceType === "internship" ? "internship" : category === "work" ? "work" : "campus",
    organization: optionalText(draft.organization),
    role: optionalText(draft.role),
    department: undefined
  });
}

function factCategoryForProfileCategory(category: ProfileCategoryId): FactCategory {
  if (category === "education") {
    return "education";
  }
  if (category === "skill") {
    return "skill";
  }
  if (category === "language") {
    return "language";
  }
  if (category === "certificate") {
    return "certificate";
  }
  if (category === "award") {
    return "achievement";
  }
  if (category === "custom") {
    return "other";
  }
  return "experience";
}

function isLanguageSkill(skill: Skill) {
  return skill.fact?.category === "language" || /语言|英语|日语|韩语|法语|德语|雅思|托福|CET/i.test(skill.name);
}

function profileCategoryLabel(category: ProfileCategoryId) {
  return profileCategories.find((item) => item.id === category)?.label ?? "资料";
}

function skillLevelLabel(level: Skill["level"]) {
  if (level === "basic") {
    return "了解";
  }
  if (level === "proficient") {
    return "熟练";
  }
  return "熟悉";
}

function FactReviewRow({
  fact,
  requirePdfLocation,
  onToggle
}: {
  fact: ProfileBuilderFact;
  requirePdfLocation: boolean;
  onToggle: (factId: string, checked: boolean) => void;
}) {
  const pdfLocatorStatus = fact.sourceLocatorStatus;
  const disabled = requirePdfLocation ? !isPdfEvidenceLocated(fact) : !fact.sourceSpan;
  return (
    <label className="review-row">
      <input
        type="checkbox"
        checked={fact.confirmedByUser}
        disabled={disabled}
        onChange={(event) => onToggle(fact.id, event.target.checked)}
      />
      <span>
        <strong>{fact.statement}</strong>
        <small>
          {fact.confidenceLevel} / {fact.confidenceReason} / 定位：{pdfLocatorStatus ?? (fact.sourceSpan ? "located" : "unlocated")} / 原文：{fact.sourceSpan?.text ?? "未定位，待确认"}
        </small>
      </span>
    </label>
  );
}

function optionalText(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function triggerJsonDownload(payload: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function synchronizeProfileStructuredFacts(nextProfile: CareerProfile, previousProfile: CareerProfile | undefined): CareerProfile {
  if (nextProfile.schemaVersion === "career-profile-v2") {
    const previous = previousProfile?.schemaVersion === "career-profile-v2" ? previousProfile : undefined;
    const previousFacts = previous?.structuredFacts ?? [];
    const nextFacts = nextProfile.structuredFacts ?? [];
    const nextIds = new Set(nextFacts.map((entry) => entry.data.id));
    const deletedIds = new Set(previousFacts
      .filter((entry) => !nextIds.has(entry.data.id))
      .map((entry) => entry.data.id));
    const deletedFactIds = new Set(previousFacts
      .filter((entry) => !nextIds.has(entry.data.id))
      .flatMap((entry) => entry.factIds));
    const isDeletedMirror = (id: string, factIds: string[]) =>
      deletedIds.has(id) || factIds.some((factId) => deletedFactIds.has(factId));
    const experiences = nextProfile.experiences.filter((item) => !isDeletedMirror(item.id, item.facts.map((fact) => fact.id)));
    const skills = nextProfile.skills.filter((item) => !isDeletedMirror(item.id, item.fact ? [item.fact.id] : []));
    const certificates = nextProfile.certificates.filter((item) => !isDeletedMirror(item.id, item.fact ? [item.fact.id] : []));
    const structuredBasics = nextProfile.structuredBasics ?? migrateCareerProfileToV2(nextProfile).structuredBasics;
    return CareerProfileSchema.parse({
      ...nextProfile,
      schemaVersion: "career-profile-v2",
      experiences,
      skills,
      certificates,
      structuredBasics,
      structuredFacts: nextFacts
    });
  }
  const previous = previousProfile ?? nextProfile;
  const previousLegacyIds = new Set([
    ...previous.experiences.map((item) => item.id),
    ...previous.skills.map((item) => item.id),
    ...previous.certificates.map((item) => item.id)
  ]);
  const previousLegacyFactIds = new Set([
    ...previous.experiences.flatMap((item) => item.facts.map((fact) => fact.id)),
    ...previous.skills.flatMap((item) => item.fact ? [item.fact.id] : []),
    ...previous.certificates.flatMap((item) => item.fact ? [item.fact.id] : [])
  ]);
  const nextFactIds = new Set((nextProfile.structuredFacts ?? []).map((entry) => entry.data.id));
  const canonicalOnlyFacts = (nextProfile.structuredFacts ?? []).filter((entry) =>
    !previousLegacyIds.has(entry.data.id)
    && !entry.factIds.some((factId) => previousLegacyFactIds.has(factId))
    && nextFactIds.has(entry.data.id)
  );
  const rebuilt = migrateCareerProfileToV2({
    ...nextProfile,
    schemaVersion: undefined,
    structuredBasics: undefined,
    structuredFacts: undefined
  });
  return CareerProfileSchema.parse({
    ...nextProfile,
    schemaVersion: "career-profile-v2",
    structuredBasics: nextProfile.structuredBasics ?? rebuilt.structuredBasics,
    structuredFacts: [...rebuilt.structuredFacts, ...canonicalOnlyFacts]
  });
}

function basicDraftFromProfile(profile: CareerProfile, profileKey: string): BasicDraftState {
  return {
    profileKey,
    name: profile.name,
    headline: profile.basics.headline ?? "",
    phone: profile.basics.phone ?? "",
    email: profile.basics.email ?? "",
    location: profile.basics.location ?? "",
    link: profile.basics.links[0] ?? ""
  };
}

function buildUserSkill(name: string, level: Skill["level"], now: string, factCategory: FactCategory = "skill", existingId?: string): Skill {
  const skillId = existingId ?? `skill-${nanoid(10)}`;
  const statement = factCategory === "language" ? name : `掌握${name}`;
  return {
    id: skillId,
    name,
    level,
    evidenceIds: [],
    lastUsedAt: undefined,
    createdAt: now,
    updatedAt: now,
    fact: {
      id: `fact-${nanoid(10)}`,
      statement,
      category: factCategory,
      confirmedByUser: true,
      riskLevel: "low",
      provenance: [{
        sourceType: "user_input",
        sourceId: skillId,
        sourceText: statement,
        confidence: 1,
        confirmedByUser: true,
        riskLevel: "low",
        createdAt: now
      }],
      createdAt: now,
      updatedAt: now
    }
  };
}

function parseArchivedSkills(value: unknown): Skill[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Skill => {
    return Boolean(
      item
      && typeof item === "object"
      && "id" in item
      && "name" in item
      && typeof item.id === "string"
      && typeof item.name === "string"
    );
  });
}

function createManualProfileOutput(rawText: string): ProfileBuilderOutput {
  const now = new Date().toISOString();
  const sourceQuote = rawText.split(/\r?\n/).find(Boolean)?.slice(0, 120) || rawText.slice(0, 120);
  const start = rawText.indexOf(sourceQuote);
  const sourceSpan = start >= 0 ? { start, end: start + sourceQuote.length, text: sourceQuote } : undefined;

  return {
    basics: {
      name: {
        value: "待确认用户",
        sourceQuote,
        sourceSpan,
        confidenceLevel: "low",
        confidenceReason: "手动模式默认占位，需要用户确认。",
        needsConfirmation: true
      },
      links: []
    },
    experiences: [
      {
        id: `manual-exp-${nanoid(8)}`,
        type: "other",
        organization: {
          value: "待分类经历",
          sourceQuote,
          sourceSpan,
          confidenceLevel: "low",
          confidenceReason: "手动模式默认分类。",
          needsConfirmation: true
        },
        role: {
          value: "待确认角色",
          sourceQuote,
          sourceSpan,
          confidenceLevel: "low",
          confidenceReason: "手动模式默认分类。",
          needsConfirmation: true
        },
        facts: [
          {
            id: `manual-fact-${nanoid(8)}`,
            statement: sourceQuote || "待补充事实",
            category: "experience",
            sourceQuote: sourceQuote || rawText,
            sourceSpan,
            confidenceLevel: "low",
            confidenceReason: "用户拒绝外部处理或 AI 不可用，需要手动确认。",
            needsConfirmation: true,
            confirmedByUser: false,
            createdAt: now,
            updatedAt: now
          }
        ],
        tags: [],
        confirmedByUser: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    skills: [],
    certificates: [],
    unclassifiedBlocks: []
  };
}

function formatPdfWarnings(warnings: string[]) {
  return warnings.map((warning) => {
    if (warning.startsWith("complex_layout")) {
      return "版面复杂：疑似双栏，文本顺序可能需要人工核对";
    }
    if (warning.startsWith("low_text_density")) {
      return "文本层过少：疑似扫描件，OCR 已后置";
    }
    if (warning.startsWith("mime_untrusted")) {
      return "MIME 不可信：已通过文件头和 PDF.js 继续校验";
    }
    if (warning.startsWith("extension_not_pdf")) {
      return "扩展名不是 .pdf：已通过文件头和 PDF.js 继续校验";
    }
    if (warning.startsWith("text_item_density")) {
      return "文本对象较多：已按上限保护处理";
    }
    return warning;
  });
}

function saveStatusLabel(status: "idle" | "saving" | "saved" | "failed" | "conflict") {
  return {
    idle: "等待保存",
    saving: "保存中",
    saved: "已保存",
    failed: "保存失败",
    conflict: "需要刷新后重试"
  }[status];
}
