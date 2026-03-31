/**
 * Configuration schema and defaults for self-learning plugin.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";

export type MemoryBackendType = "openviking" | "none";

export type HermesLearningConfig = {
  memoryBackendType: MemoryBackendType;
  memoryBackendUrl: string;
  memoryBackendApiKey: string;
  memoryBackendTimeoutMs: number;
  skillsDir: string;
  skillReviewThreshold: number;
  enableToolStats: boolean;
  enableSkillReview: boolean;
  enableCrossAgentRecall: boolean;
  enableCompaction: boolean;
  enableTrajectory: boolean;
  compactionBudgetPercent: number;
  compactionMinTokens: number;
  compactionMaxTokens: number;
  trajectoryDir: string;
  crossAgentScopes: string[];
};

const DEFAULTS: HermesLearningConfig = {
  memoryBackendType: "none",
  memoryBackendUrl: "http://host.docker.internal:1933",
  memoryBackendApiKey: "",
  memoryBackendTimeoutMs: 10_000,
  skillsDir: resolve(homedir(), ".openclaw/skills/auto"),
  skillReviewThreshold: 5,
  enableToolStats: true,
  enableSkillReview: true,
  enableCrossAgentRecall: false,
  enableCompaction: true,
  enableTrajectory: false,
  compactionBudgetPercent: 20,
  compactionMinTokens: 2000,
  compactionMaxTokens: 8000,
  trajectoryDir: resolve(homedir(), ".openclaw/trajectories"),
  crossAgentScopes: [],
};

export function parseConfig(raw: unknown): HermesLearningConfig {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cfg = { ...DEFAULTS };

  // memoryBackendType
  if (typeof input.memoryBackendType === "string" && (input.memoryBackendType === "openviking" || input.memoryBackendType === "none")) {
    cfg.memoryBackendType = input.memoryBackendType;
  }

  // Generic memory backend fields (preferred)
  if (typeof input.memoryBackendUrl === "string") cfg.memoryBackendUrl = input.memoryBackendUrl;
  if (typeof input.memoryBackendApiKey === "string") cfg.memoryBackendApiKey = input.memoryBackendApiKey;
  if (typeof input.memoryBackendTimeoutMs === "number") cfg.memoryBackendTimeoutMs = input.memoryBackendTimeoutMs;

  // Backward compat: accept old viking* field names
  if (typeof input.vikingBaseUrl === "string") { cfg.memoryBackendUrl = input.vikingBaseUrl; cfg.memoryBackendType = "openviking"; }
  if (typeof input.vikingApiKey === "string") { cfg.memoryBackendApiKey = input.vikingApiKey; }
  if (typeof input.vikingTimeoutMs === "number") { cfg.memoryBackendTimeoutMs = input.vikingTimeoutMs; }

  if (typeof input.skillsDir === "string") {
    cfg.skillsDir = input.skillsDir.startsWith("~")
      ? resolve(homedir(), input.skillsDir.slice(2))
      : resolve(input.skillsDir);
  }
  if (typeof input.skillReviewThreshold === "number") cfg.skillReviewThreshold = input.skillReviewThreshold;
  if (typeof input.enableToolStats === "boolean") cfg.enableToolStats = input.enableToolStats;
  if (typeof input.enableSkillReview === "boolean") cfg.enableSkillReview = input.enableSkillReview;
  if (typeof input.enableCrossAgentRecall === "boolean") cfg.enableCrossAgentRecall = input.enableCrossAgentRecall;
  if (typeof input.enableCompaction === "boolean") cfg.enableCompaction = input.enableCompaction;
  if (typeof input.enableTrajectory === "boolean") cfg.enableTrajectory = input.enableTrajectory;
  if (typeof input.compactionBudgetPercent === "number") cfg.compactionBudgetPercent = input.compactionBudgetPercent;
  if (typeof input.compactionMinTokens === "number") cfg.compactionMinTokens = input.compactionMinTokens;
  if (typeof input.compactionMaxTokens === "number") cfg.compactionMaxTokens = input.compactionMaxTokens;
  if (typeof input.trajectoryDir === "string") {
    cfg.trajectoryDir = input.trajectoryDir.startsWith("~")
      ? resolve(homedir(), input.trajectoryDir.slice(2))
      : resolve(input.trajectoryDir);
  }
  if (Array.isArray(input.crossAgentScopes)) {
    cfg.crossAgentScopes = input.crossAgentScopes.filter((s): s is string => typeof s === "string");
  }

  return cfg;
}
