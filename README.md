# openclaw-self-learning

A self-learning plugin for [OpenClaw](https://github.com/nicepkg/openclaw) that enables agents to create reusable skills from experience, capture trajectories for fine-tuning, compress context intelligently, and share memories across agents.

Works standalone out of the box. Optionally connects to a memory backend (e.g. [OpenViking](https://github.com/nicepkg/openviking)) for cross-agent recall.

## How It Works

The plugin hooks into OpenClaw's agent lifecycle at four phases:

```
Agent Run
  |
  |-- [Phase 1] Tool stats tracked (after_tool_call)
  |-- [Phase 3] Compaction template injected (before_compaction)
  |-- [Phase 4] LLM I/O + tool calls captured (llm_input, llm_output, after_tool_call)
  |
  v
Agent End
  |-- [Phase 1] Stats flushed, skill review spawned if threshold met (agent_end)
  |-- [Phase 2A] Cross-agent context injected (before_prompt_build) *requires memory backend*
```

### Phase 1: Self-Improving Skills

Agents automatically learn from their own workflows. When an agent completes a run with enough tool calls (configurable threshold), a background subagent reviews the session and decides whether to save the workflow as a reusable skill.

**Tools provided:**

| Tool | Description |
|------|-------------|
| `skill_create` | Create a new SKILL.md with YAML frontmatter and instructions |
| `skill_patch` | Targeted find-and-replace within an existing skill |
| `skill_list` | List available skills with metadata, filter by category or query |

**Skill format:**

```markdown
---
name: summarize-meeting-notes
description: Extract action items and decisions from raw meeting transcripts
version: 1.0.0
metadata:
  tags: [notes, extraction]
  auto_created: true
---

# Summarize Meeting Notes

## When to Use
When a user provides raw meeting transcripts or asks to process meeting notes.

## Steps
1. Identify participants and date from the transcript
2. Extract key decisions made during the meeting
3. List action items with assignees and deadlines
4. Summarize unresolved topics for follow-up

## Common Pitfalls
- Missing context when transcript is partial
- Confusing discussion points with actual decisions

## Verification
- Confirm all action items have an assignee
- Cross-check decisions against the original transcript
```

All agent-created skills go through a **security scanner** that checks for:
- Secret exfiltration (curl/wget/fetch with env vars, SSH/AWS/kube credential access)
- Prompt injection (role hijack, instruction override, chat template tokens)
- Destructive commands (rm -rf, DROP TABLE, disk format)
- Persistence attempts (cron jobs, systemd services)
- Obfuscation (base64 decode pipes, eval of decoded strings)

Skills flagged as `dangerous` are blocked. Skills flagged as `caution` are allowed with a warning.

### Phase 2A: Cross-Agent Memory Bridge

*Requires a memory backend (e.g. OpenViking).*

Enables agents to search each other's memories and episodes. A CEO-type agent (e.g. "Zenith") can recall what other agents discussed or decided.

**Tool provided:**

| Tool | Description |
|------|-------------|
| `cross_agent_recall` | Search memories across multiple agent scopes |

Additionally, a `before_prompt_build` hook auto-injects relevant cross-agent context into the CEO agent's system prompt, so it stays informed without explicit tool calls.

### Phase 3: Structured Context Compression

When OpenClaw compacts a long conversation, this phase injects a structured template so the compaction LLM produces organized output instead of free-form summaries:

```
## Goal
## Constraints & Preferences
## Progress (Done / In Progress / Blocked)
## Key Decisions
## Relevant Files
## Next Steps
## Critical Context
```

This preserves file paths, command outputs, error messages, and configuration values that free-form summaries tend to lose.

### Phase 4: Trajectory Capture

Records LLM inputs, outputs, and tool calls as JSONL for future fine-tuning or analysis. Entries are buffered in memory and flushed to date-partitioned files every 30 seconds.

```
~/.openclaw/trajectories/trajectory-2026-03-31.jsonl
```

Each line contains:
```json
{
  "ts": 1711900000000,
  "type": "tool_call",
  "runId": "abc-123",
  "agentId": "zenith",
  "data": { "toolName": "skill_create", "durationMs": 42 }
}
```

## Installation

Clone into your OpenClaw extensions directory:

```bash
cd ~/.openclaw/extensions/
git clone https://github.com/zeattacker/openclaw-self-learning.git self-learning
cd self-learning
npm install
```

Then register it in your `~/.openclaw/openclaw.json`:

```json
{
  "extensions": {
    "self-learning": {
      "enabled": true,
      "config": {}
    }
  }
}
```

Restart the gateway:

```bash
docker restart openclaw-gateway
```

## Configuration

All options are set under `extensions.self-learning.config` in `openclaw.json`:

```json
{
  "extensions": {
    "self-learning": {
      "enabled": true,
      "config": {
        "memoryBackendType": "none",
        "memoryBackendUrl": "http://host.docker.internal:1933",
        "memoryBackendApiKey": "",
        "skillsDir": "~/.openclaw/skills/auto",
        "skillReviewThreshold": 5,
        "enableToolStats": true,
        "enableSkillReview": true,
        "enableCrossAgentRecall": false,
        "enableCompaction": true,
        "enableTrajectory": false,
        "trajectoryDir": "~/.openclaw/trajectories",
        "crossAgentScopes": []
      }
    }
  }
}
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `memoryBackendType` | `"openviking"` \| `"none"` | `"none"` | Memory backend type. `"none"` = standalone mode |
| `memoryBackendUrl` | string | `http://host.docker.internal:1933` | URL of the memory backend |
| `memoryBackendApiKey` | string | `""` | API key for the memory backend |
| `memoryBackendTimeoutMs` | number | `10000` | Request timeout in milliseconds |
| `skillsDir` | string | `~/.openclaw/skills/auto` | Where agent-created skills are stored |
| `skillReviewThreshold` | number | `5` | Minimum tool calls to trigger skill review |
| `enableToolStats` | boolean | `true` | Track per-tool call counts and durations |
| `enableSkillReview` | boolean | `true` | Auto-spawn skill review subagent on agent_end |
| `enableCrossAgentRecall` | boolean | `false` | Enable cross-agent memory search (needs backend) |
| `enableCompaction` | boolean | `true` | Inject structured compaction template |
| `enableTrajectory` | boolean | `false` | Capture LLM I/O and tool calls as JSONL |
| `trajectoryDir` | string | `~/.openclaw/trajectories` | Where trajectory JSONL files are written |
| `crossAgentScopes` | string[] | `[]` | Agent IDs to include in cross-agent search |

### Minimal Setup (standalone, no memory backend)

```json
{
  "config": {}
}
```

This gives you skill auto-creation, structured compaction, and tool stats tracking. No external dependencies.

### With OpenViking

```json
{
  "config": {
    "memoryBackendType": "openviking",
    "memoryBackendUrl": "http://host.docker.internal:1933",
    "memoryBackendApiKey": "your-api-key",
    "enableCrossAgentRecall": true,
    "crossAgentScopes": ["zenith", "cipher", "orion", "ledger"]
  }
}
```

### Backward Compatibility

Old `vikingBaseUrl`, `vikingApiKey`, and `vikingTimeoutMs` field names are still accepted. Setting `vikingBaseUrl` automatically sets `memoryBackendType` to `"openviking"`.

## Architecture

```
self-learning/
  index.ts                    # Plugin entry point, backend factory
  config.ts                   # Config schema, defaults, parsing
  types.ts                    # MemoryBackend interface, shared types
  viking-client.ts            # OpenViking backend implementation
  security-scanner.ts         # Threat pattern scanner for skills
  tools/
    skill-create.ts           # skill_create tool
    skill-patch.ts            # skill_patch tool
    skill-list.ts             # skill_list tool
    skill-utils.ts            # Validation, search, frontmatter parsing
    cross-agent-recall.ts     # cross_agent_recall tool
  hooks/
    tool-stats-tracker.ts     # after_tool_call stats accumulator
    skill-reviewer.ts         # agent_end skill review spawner
    zenith-context.ts         # before_prompt_build cross-agent injection
    compaction-template.ts    # before_compaction structured template
    trajectory-capture.ts     # llm_input/llm_output/after_tool_call capture
  services/
    trajectory-writer.ts      # Periodic JSONL flush service
```

### MemoryBackend Interface

The plugin is backend-agnostic. To add a new memory backend, implement the `MemoryBackend` interface from `types.ts`:

```typescript
interface MemoryBackend {
  readonly type: string;
  healthCheck(): Promise<boolean>;
  find(query: string, options: { targetUri: string; limit: number; scoreThreshold?: number }, agentId?: string): Promise<FindResult>;
  read(uri: string, agentId?: string): Promise<string>;
  writeFile(uri: string, content: string, agentId?: string): Promise<void>;
  deleteUri(uri: string, agentId?: string): Promise<void>;
  trackRecall(uris: string[]): Promise<void>;
}
```

Then add your type to `MemoryBackendType` in `config.ts` and a case in the `createMemoryBackend()` factory in `index.ts`.

## Feature Matrix

| Feature | Standalone | With Memory Backend |
|---------|-----------|-------------------|
| Skill auto-creation | Yes | Yes |
| Skill review subagent | Yes | Yes |
| Tool stats tracking | Yes | Yes + persisted to backend |
| Structured compaction | Yes | Yes |
| Trajectory capture | Yes | Yes |
| Cross-agent recall | No | Yes |
| Cross-agent context injection | No | Yes |

## License

MIT
