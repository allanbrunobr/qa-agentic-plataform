/**
 * Ingestion Boundary — single seam for all untrusted external content
 * (repo source code, DOM evidence, tool outputs, etc.) before it reaches
 * LLM prompts, memory, or artifacts.
 *
 * Follows .specs/agent-security/ principles:
 * - Hostilidade por padrão (treat everything external as LOW trust)
 * - Sanitize na fronteira de ingestão (this is the canonical place)
 * - Provenance + trust labeling on every piece of data
 * - Data ≠ code separation via explicit wrappers
 *
 * See: REMEDIATION_PLAN_2026-06-11.md (Phase 1, Ingestion Boundary)
 * and .specs/agent-security/security-best-practices-for-agents.md
 *
 * Current wiring (first slice):
 * - llm-discovery.ts (repo files + path metadata into discovery prompts)
 *
 * TODO (next slices): wire browser-page-evidence, generated-adapter-tools outputs,
 * and any L5 memory/feedback ingestion paths.
 */

export type SourceKind =
  | 'repo_file'
  | 'repo_path'
  | 'dom_evidence'
  | 'tool_output'
  | 'cli_stdout';

export interface Provenance {
  sourceKind: SourceKind;
  originalPath?: string;
  trustLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  ingestedAt: string;
  // Future: contentHash, originalLength, redactedFields, etc.
}

export interface SanitizedContent {
  /** The content wrapped and neutralized, safe to include in prompts/memory. */
  sanitized: string;
  provenance: Provenance;
  /** Original length before any processing (useful for logging/auditing). */
  originalLength: number;
}

/**
 * The canonical wrapper text. Agents and critics are instructed to treat
 * everything between these markers as untrusted data, never as instructions.
 */
const BEGIN_MARKER = 'BEGIN_EXTERNAL_UNTRUSTED_CONTENT';
const END_MARKER = 'END_EXTERNAL_UNTRUSTED_CONTENT';

/**
 * Neutralizes common syntactic injection attempts (System: prompts, role markers,
 * "ignore previous instructions", etc.). This is a first line of defense;
 * the wrapper + provenance is the real boundary.
 */
function neutralizeSyntacticMarkers(text: string): string {
  return text
    // Common jailbreak / role injection patterns
    .replace(/^\s*(System:|###\s*System|<\s*\|im_start\|>\s*system)/gmi, '[REDACTED_SYSTEM_MARKER]')
    // More flexible "ignore previous instructions" style (with words in between)
    .replace(/ignore[\s\S]{0,40}?previous[\s\S]{0,40}?instructions?/gi, '[REDACTED_IGNORE_INSTRUCTION]')
    .replace(/role\s*:\s*(system|assistant|user)/gi, '[REDACTED_ROLE_MARKER]')
    // XML / special token attempts
    .replace(/<\s*\|im_start\|>[\s\S]*?<\s*\|im_end\|>/g, '[REDACTED_SPECIAL_TOKEN]')
    // Very long "ignore" style instructions (heuristic)
    .replace(/(?:(?:do not|never|ignore|disregard)[^\n]{0,80}){2,}/gi, '[REDACTED_INJECTION_ATTEMPT]');
}

/**
 * Basic DOM / HTML invisible layer stripping (for future dom_evidence use).
 * Keeps the intent visible while removing hidden instruction channels.
 */
function stripInvisibleHtmlLayers(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '[HTML_COMMENT_REDACTED]')
    .replace(/\s(aria-[\w-]+|data-[\w-]+)\s*=\s*["'][^"']*["']/gi, ' [REDACTED_ATTR] ');
}

/**
 * Main entry point for the ingestion boundary.
 *
 * Every piece of content that originates outside the trusted platform
 * (host repo files, scraped DOM, tool responses, CLI output, etc.)
 * MUST go through this function (or a future stricter version) before
 * being placed into any LLM context, long-term memory, or user-facing artifact.
 */
export function sanitizeExternalContent(
  raw: string,
  kind: SourceKind,
  meta: { originalPath?: string } = {}
): SanitizedContent {
  if (typeof raw !== 'string') {
    raw = String(raw ?? '');
  }

  let cleaned = raw;

  // 1. Neutralize syntactic command injection attempts
  cleaned = neutralizeSyntacticMarkers(cleaned);

  // 2. For file/DOM sources, strip common invisible channels
  if (kind === 'repo_file' || kind === 'dom_evidence') {
    cleaned = stripInvisibleHtmlLayers(cleaned);
  }

  // 3. Build the explicit untrusted wrapper with provenance
  const pathInfo = meta.originalPath ? ` path=${meta.originalPath}` : '';
  const wrapped = `${BEGIN_MARKER} (source=${kind}${pathInfo}, trust=LOW)
${cleaned}
${END_MARKER}`;

  return {
    sanitized: wrapped,
    provenance: {
      sourceKind: kind,
      originalPath: meta.originalPath,
      trustLevel: 'LOW',
      ingestedAt: new Date().toISOString(),
    },
    originalLength: raw.length,
  };
}

/**
 * Convenience helper for the common case of repo file snippets during discovery.
 */
export function sanitizeRepoFileSnippet(
  content: string,
  filePath: string
): SanitizedContent {
  return sanitizeExternalContent(content, 'repo_file', { originalPath: filePath });
}

/**
 * Convenience for the repository root path metadata itself.
 */
export function sanitizeRepoPath(repoPath: string): SanitizedContent {
  return sanitizeExternalContent(repoPath, 'repo_path', { originalPath: repoPath });
}
