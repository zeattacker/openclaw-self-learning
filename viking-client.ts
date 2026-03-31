/**
 * OpenViking memory backend implementation.
 * Talks to a running OpenViking instance over HTTP.
 */

import { createHash } from "node:crypto";
import type { MemoryBackend, FindResult } from "./types.js";

type ScopeName = "user" | "agent";
type LsEntry = { name?: string; uri?: string; isDir?: boolean };

const AGENT_STRUCTURE_DIRS = new Set(["memories", "skills", "instructions", "workspaces"]);
const USER_STRUCTURE_DIRS = new Set(["memories", "episodes"]);

function md5Short(input: string): string {
  return createHash("md5").update(input).digest("hex").slice(0, 12);
}

export class VikingClient implements MemoryBackend {
  readonly type = "openviking";
  private spaceCache = new Map<string, Partial<Record<ScopeName, string>>>();
  private identityCache = new Map<string, { userId: string; agentId: string }>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly defaultAgentId: string,
    private readonly timeoutMs: number,
  ) {}

  // ---------------------------------------------------------------------------
  // HTTP transport
  // ---------------------------------------------------------------------------

  private async request<T>(path: string, init: RequestInit = {}, agentId?: string): Promise<T> {
    const effectiveAgentId = agentId ?? this.defaultAgentId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers ?? {});
      if (this.apiKey) headers.set("X-API-Key", this.apiKey);
      if (effectiveAgentId) headers.set("X-OpenViking-Agent", effectiveAgentId);

      // Tenant headers — skip for system/health endpoints to avoid circular identity lookup
      const skipTenant = path.startsWith("/api/v1/system/") || path.startsWith("/health");
      if (!skipTenant) {
        const identity = await this.getRuntimeIdentity(agentId);
        headers.set("X-OpenViking-Account", identity.userId);
        headers.set("X-OpenViking-User", identity.userId);
      } else {
        headers.set("X-OpenViking-Account", "default");
        headers.set("X-OpenViking-User", effectiveAgentId || "self-learning");
      }

      if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        result?: T;
        error?: { code?: string; message?: string };
      };

      if (!response.ok || payload.status === "error") {
        const code = payload.error?.code ? ` [${payload.error.code}]` : "";
        const message = payload.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`OpenViking request failed${code}: ${message}`);
      }

      return (payload.result ?? payload) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Identity & URI normalization (ported from openviking extension)
  // ---------------------------------------------------------------------------

  private async getRuntimeIdentity(agentId?: string): Promise<{ userId: string; agentId: string }> {
    const effectiveAgentId = agentId ?? this.defaultAgentId;
    const cached = this.identityCache.get(effectiveAgentId);
    if (cached) return cached;

    const fallback = { userId: "default", agentId: effectiveAgentId || "default" };
    try {
      const status = await this.request<{ user?: unknown }>("/api/v1/system/status", {}, agentId);
      const userId =
        typeof status.user === "string" && status.user.trim() ? status.user.trim() : "default";
      const identity = { userId, agentId: effectiveAgentId || "default" };
      this.identityCache.set(effectiveAgentId, identity);
      return identity;
    } catch {
      this.identityCache.set(effectiveAgentId, fallback);
      return fallback;
    }
  }

  private async resolveScopeSpace(scope: ScopeName, agentId?: string): Promise<string> {
    const effectiveAgentId = agentId ?? this.defaultAgentId;
    const agentScopes = this.spaceCache.get(effectiveAgentId);
    const cached = agentScopes?.[scope];
    if (cached) return cached;

    const identity = await this.getRuntimeIdentity(agentId);
    const preferredSpace =
      scope === "user" ? identity.userId : md5Short(`${identity.userId}:${identity.agentId}`);
    const reservedDirs = scope === "user" ? USER_STRUCTURE_DIRS : AGENT_STRUCTURE_DIRS;

    const saveSpace = (space: string) => {
      const existing = this.spaceCache.get(effectiveAgentId) ?? {};
      existing[scope] = space;
      this.spaceCache.set(effectiveAgentId, existing);
    };

    try {
      const entries = await this.ls(`viking://${scope}`, agentId);
      const spaces = entries
        .filter((e) => e?.isDir === true)
        .map((e) => (typeof e.name === "string" ? e.name.trim() : ""))
        .filter((name) => name && !name.startsWith(".") && !reservedDirs.has(name));

      if (spaces.length > 0) {
        if (spaces.includes(preferredSpace)) {
          saveSpace(preferredSpace);
          return preferredSpace;
        }
        if (scope === "user" && spaces.includes("default")) {
          saveSpace("default");
          return "default";
        }
        if (spaces.length === 1) {
          saveSpace(spaces[0]!);
          return spaces[0]!;
        }
      }
    } catch {
      // Fall back to identity-derived space
    }

    saveSpace(preferredSpace);
    return preferredSpace;
  }

  private async normalizeUri(uri: string, agentId?: string): Promise<string> {
    const trimmed = uri.trim().replace(/\/+$/, "");
    const match = trimmed.match(/^viking:\/\/(user|agent)(?:\/(.*))?$/);
    if (!match) return trimmed;

    const scope = match[1] as ScopeName;
    const rawRest = (match[2] ?? "").trim();
    if (!rawRest) return trimmed;

    const parts = rawRest.split("/").filter(Boolean);
    if (parts.length === 0) return trimmed;

    const reservedDirs = scope === "user" ? USER_STRUCTURE_DIRS : AGENT_STRUCTURE_DIRS;
    if (!reservedDirs.has(parts[0]!)) return trimmed;

    const space = await this.resolveScopeSpace(scope, agentId);
    return `viking://${scope}/${space}/${parts.join("/")}`;
  }

  private async ls(uri: string, agentId?: string): Promise<LsEntry[]> {
    const result = await this.request<LsEntry[]>(
      `/api/v1/fs/ls?uri=${encodeURIComponent(uri)}`,
      {},
      agentId,
    );
    return Array.isArray(result) ? result : [];
  }

  // ---------------------------------------------------------------------------
  // MemoryBackend interface
  // ---------------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("/health");
      return true;
    } catch {
      return false;
    }
  }

  async find(
    query: string,
    options: { targetUri: string; limit: number; scoreThreshold?: number },
    agentId?: string,
  ): Promise<FindResult> {
    const normalizedUri = await this.normalizeUri(options.targetUri, agentId);
    return this.request<FindResult>(
      "/api/v1/search/find",
      {
        method: "POST",
        body: JSON.stringify({
          query,
          target_uri: normalizedUri,
          limit: options.limit,
          score_threshold: options.scoreThreshold,
        }),
      },
      agentId,
    );
  }

  async read(uri: string, agentId?: string): Promise<string> {
    const normalizedUri = await this.normalizeUri(uri, agentId);
    return this.request<string>(
      `/api/v1/content/read?uri=${encodeURIComponent(normalizedUri)}`,
      {},
      agentId,
    );
  }

  async writeFile(uri: string, content: string, agentId?: string): Promise<void> {
    const normalizedUri = await this.normalizeUri(uri, agentId);
    await this.request<{ uri: string }>(
      "/api/v1/fs/write",
      { method: "POST", body: JSON.stringify({ uri: normalizedUri, content }) },
      agentId,
    );
  }

  async deleteUri(uri: string, agentId?: string): Promise<void> {
    const normalizedUri = await this.normalizeUri(uri, agentId);
    await this.request(
      `/api/v1/fs?uri=${encodeURIComponent(normalizedUri)}&recursive=false`,
      { method: "DELETE" },
      agentId,
    );
  }

  async trackRecall(uris: string[]): Promise<void> {
    if (uris.length === 0) return;
    await this.request<{ updated: number }>(
      "/api/v1/search/track-recall",
      { method: "POST", body: JSON.stringify({ uris }) },
    );
  }
}
