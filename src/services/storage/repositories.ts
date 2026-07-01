import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  AiLogSchema,
  CareerProfileSchema,
  ExportRecordSchema,
  JobDescriptionSchema,
  ResumeBranchSchema,
  type AiLog,
  type CareerProfile,
  type ExportRecord,
  type JobDescription,
  type ResumeBranch
} from "@/domain/schemas";
import { CareerAdaptDb, careerAdaptDb, type AppMeta } from "./db";

export type WorkspaceExport = {
  schemaVersion: "stage-a-v1";
  exportedAt: string;
  profiles: CareerProfile[];
  jobDescriptions: JobDescription[];
  resumeBranches: ResumeBranch[];
  aiLogs: AiLog[];
  exportRecords: ExportRecord[];
  appMeta: AppMeta[];
};

export class WorkspaceRepository {
  constructor(private readonly db: CareerAdaptDb = careerAdaptDb) {}

  async seedDemoWorkspace() {
    await this.saveProfile(demoCareerProfile);
    await this.saveJobDescriptions(demoJobDescriptions);
    await this.setMeta("demoSeededAt", new Date().toISOString());
  }

  async ensureDemoWorkspace() {
    const seededAt = await this.getMeta("demoSeededAt");

    if (!seededAt) {
      await this.seedDemoWorkspace();
      return true;
    }

    return false;
  }

  async saveProfile(profile: CareerProfile) {
    const parsed = CareerProfileSchema.parse(profile);
    await this.db.profiles.put(parsed);
    return parsed;
  }

  async getProfile(id: string) {
    const profile = await this.db.profiles.get(id);
    return profile ? CareerProfileSchema.parse(profile) : undefined;
  }

  async listProfiles() {
    const profiles = await this.db.profiles.toArray();
    return profiles.map((profile) => CareerProfileSchema.parse(profile));
  }

  async saveJobDescription(jobDescription: JobDescription) {
    const parsed = JobDescriptionSchema.parse(jobDescription);
    await this.db.jobDescriptions.put(parsed);
    return parsed;
  }

  async saveJobDescriptions(jobDescriptions: JobDescription[]) {
    const parsed = jobDescriptions.map((jobDescription) => JobDescriptionSchema.parse(jobDescription));
    await this.db.jobDescriptions.bulkPut(parsed);
    return parsed;
  }

  async listJobDescriptions() {
    const jobDescriptions = await this.db.jobDescriptions.toArray();
    return jobDescriptions.map((jobDescription) => JobDescriptionSchema.parse(jobDescription));
  }

  async saveResumeBranch(branch: ResumeBranch) {
    const parsed = ResumeBranchSchema.parse(branch);
    await this.db.resumeBranches.put(parsed);
    return parsed;
  }

  async listResumeBranches() {
    const branches = await this.db.resumeBranches.toArray();
    return branches.map((branch) => ResumeBranchSchema.parse(branch));
  }

  async saveAiLogs(logs: AiLog[]) {
    const parsed = logs.map((log) => AiLogSchema.parse(log));
    await this.db.aiLogs.bulkPut(parsed);
    return parsed;
  }

  async saveExportRecord(record: ExportRecord) {
    const parsed = ExportRecordSchema.parse(record);
    await this.db.exportRecords.put(parsed);
    return parsed;
  }

  async setMeta(key: string, value: unknown) {
    const meta = {
      key,
      value,
      updatedAt: new Date().toISOString()
    };

    await this.db.appMeta.put(meta);
    return meta;
  }

  async getMeta(key: string) {
    return this.db.appMeta.get(key);
  }

  async exportWorkspaceJson(): Promise<WorkspaceExport> {
    return {
      schemaVersion: "stage-a-v1",
      exportedAt: new Date().toISOString(),
      profiles: await this.listProfiles(),
      jobDescriptions: await this.listJobDescriptions(),
      resumeBranches: await this.listResumeBranches(),
      aiLogs: (await this.db.aiLogs.toArray()).map((log) => AiLogSchema.parse(log)),
      exportRecords: (await this.db.exportRecords.toArray()).map((record) => ExportRecordSchema.parse(record)),
      appMeta: await this.db.appMeta.toArray()
    };
  }
}
