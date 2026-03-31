/**
 * Security scanner for skill content.
 * Ported from hermes-agent/tools/skills_guard.py.
 *
 * Scans SKILL.md content for known-bad patterns:
 * exfiltration, prompt injection, destructive commands, persistence, obfuscation.
 */

import type { Finding, ScanResult } from "./types.js";

type ThreatPattern = {
  regex: RegExp;
  patternId: string;
  severity: Finding["severity"];
  category: Finding["category"];
  description: string;
};

const THREAT_PATTERNS: ThreatPattern[] = [
  // Exfiltration: shell commands leaking secrets
  { regex: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/gi,
    patternId: "env_exfil_curl", severity: "critical", category: "exfiltration",
    description: "curl command interpolating secret environment variable" },
  { regex: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/gi,
    patternId: "env_exfil_wget", severity: "critical", category: "exfiltration",
    description: "wget command interpolating secret environment variable" },
  { regex: /fetch\s*\([^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|API)/gi,
    patternId: "env_exfil_fetch", severity: "critical", category: "exfiltration",
    description: "fetch() call interpolating secret environment variable" },
  { regex: /requests\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)/gi,
    patternId: "env_exfil_requests", severity: "critical", category: "exfiltration",
    description: "requests library call with secret variable" },

  // Exfiltration: credential store access
  { regex: /\$HOME\/\.ssh|~\/\.ssh/gi,
    patternId: "ssh_dir_access", severity: "high", category: "exfiltration",
    description: "references user SSH directory" },
  { regex: /\$HOME\/\.aws|~\/\.aws/gi,
    patternId: "aws_dir_access", severity: "high", category: "exfiltration",
    description: "references user AWS credentials directory" },
  { regex: /\$HOME\/\.kube|~\/\.kube/gi,
    patternId: "kube_dir_access", severity: "high", category: "exfiltration",
    description: "references Kubernetes config directory" },
  { regex: /\$HOME\/\.openclaw\/\.env|~\/\.openclaw\/\.env/gi,
    patternId: "openclaw_env_access", severity: "critical", category: "exfiltration",
    description: "references OpenClaw environment secrets" },
  { regex: /authorized_keys|\.ssh\/id_/gi,
    patternId: "ssh_key_access", severity: "high", category: "exfiltration",
    description: "references SSH keys directly" },

  // Prompt injection
  { regex: /ignore\s+(previous|all|above|prior)\s+instructions/gi,
    patternId: "prompt_injection_ignore", severity: "critical", category: "injection",
    description: "prompt injection: ignore previous instructions" },
  { regex: /you\s+are\s+now\s+/gi,
    patternId: "role_hijack", severity: "high", category: "injection",
    description: "prompt injection: role hijack attempt" },
  { regex: /system\s*prompt\s*override/gi,
    patternId: "system_prompt_override", severity: "critical", category: "injection",
    description: "prompt injection: system prompt override" },
  { regex: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/gi,
    patternId: "chat_template_injection", severity: "high", category: "injection",
    description: "chat template token injection" },

  // Destructive commands
  { regex: /rm\s+-rf\s+[\/~]/gi,
    patternId: "destructive_rm_rf", severity: "critical", category: "destructive",
    description: "recursive force delete from root or home" },
  { regex: /DROP\s+(TABLE|DATABASE|SCHEMA)/gi,
    patternId: "destructive_sql_drop", severity: "high", category: "destructive",
    description: "SQL DROP command" },
  { regex: /mkfs\.|format\s+[A-Z]:/gi,
    patternId: "destructive_format", severity: "critical", category: "destructive",
    description: "disk format command" },

  // Persistence
  { regex: /crontab\s+-[el]|\/etc\/cron/gi,
    patternId: "persistence_cron", severity: "medium", category: "persistence",
    description: "cron job modification" },
  { regex: /systemctl\s+(enable|start)|launchctl\s+load/gi,
    patternId: "persistence_service", severity: "medium", category: "persistence",
    description: "system service registration" },

  // Obfuscation
  { regex: /base64\s+(-d|--decode)\s*[|&]/gi,
    patternId: "obfuscation_base64_pipe", severity: "high", category: "obfuscation",
    description: "base64 decode piped to execution" },
  { regex: /eval\s*\(\s*(atob|Buffer\.from|decodeURIComponent)/gi,
    patternId: "obfuscation_eval_decode", severity: "critical", category: "obfuscation",
    description: "eval of decoded/deobfuscated string" },
  { regex: /\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}/gi,
    patternId: "obfuscation_hex_escape", severity: "medium", category: "obfuscation",
    description: "multiple hex escape sequences (potential obfuscation)" },
];

// Install policy for agent-created skills:
// safe=allow, caution=allow (log warning), dangerous=block
const SEVERITY_WEIGHTS: Record<Finding["severity"], number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
};

export function scanSkillContent(content: string): ScanResult {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const pattern of THREAT_PATTERNS) {
    // Reset regex state (global flag)
    pattern.regex.lastIndex = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(line);
      if (match) {
        findings.push({
          patternId: pattern.patternId,
          severity: pattern.severity,
          category: pattern.category,
          line: lineIdx + 1,
          match: match[0].slice(0, 100),
          description: pattern.description,
        });
      }
    }
  }

  // Determine verdict based on highest severity
  let totalWeight = 0;
  let hasCritical = false;
  for (const f of findings) {
    totalWeight += SEVERITY_WEIGHTS[f.severity];
    if (f.severity === "critical") hasCritical = true;
  }

  let verdict: ScanResult["verdict"] = "safe";
  if (hasCritical || totalWeight >= 10) {
    verdict = "dangerous";
  } else if (totalWeight > 0) {
    verdict = "caution";
  }

  return { verdict, findings };
}

export function shouldAllowSkill(result: ScanResult): { allowed: boolean; reason?: string } {
  if (result.verdict === "safe") return { allowed: true };
  if (result.verdict === "caution") return { allowed: true }; // allow with warning for agent-created
  // dangerous = block
  const criticals = result.findings.filter((f) => f.severity === "critical");
  const reason = criticals.length > 0
    ? `Blocked: ${criticals.map((f) => f.description).join("; ")}`
    : `Blocked: security score too high (${result.findings.length} findings)`;
  return { allowed: false, reason };
}
