/**
 * Ingestion Boundary — single seam for untrusted external content before LLM prompts/memory.
 *
 * IMPORTANT (narrow first slice, Phase 1):
 * - Currently wired only for repo file *contents* and repoPath in llm-discovery.ts buildPrompt.
 * - File list metadata and "FILE:" path labels are sanitized in this slice (see llm-discovery.ts).
 * - DOM evidence, tool outputs, CLI, L5 feedback etc. are still TODO (see plan).
 *
 * Follows .specs/agent-security/:
 * - Hostilidade por padrão
 * - Sanitize na fronteira de ingestão (Content Sanitizer / Context Normalizer)
 * - Data ≠ code via explicit wrappers + provenance
 * - Syntactic masking control
 *
 * See: REMEDIATION_PLAN_2026-06-11.md and .specs/agent-security/security-best-practices-for-agents.md
 */

import { createHash } from 'node:crypto'

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
  /** Short SHA256 prefix of the original raw content (for audit/tracing). */
  contentHash: string;
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
  let cleaned = text;

  // Stronger syntactic masking / Content Injection defense (expanded from .specs/agent-security/)
  // Non-anchored "System:" anywhere (mid-line, after newlines in paths, etc.)
  cleaned = cleaned.replace(/(?:^|[\s\n\r])(System:|###\s*System|<\s*\|im_start\|>\s*system|System prompt|Developer Mode|override prompt)/gmi, ' [REDACTED_SYSTEM_MARKER] ');

  // Broad "ignore / override previous" patterns (very large window, multiple variants)
  cleaned = cleaned.replace(/(?:ignore|disregard|forget|override|reset|bypass|disobey)[\s\S]{0,200}?(?:previous|prior|all|above|earlier|instructions?|rules?|prompts?|guidance|context|everything|directives?)/gi, '[REDACTED_IGNORE_INSTRUCTION]');

  cleaned = cleaned.replace(/role\s*:\s*(system|assistant|user)/gi, '[REDACTED_ROLE_MARKER]');

  // Special tokens and XML-style
  cleaned = cleaned.replace(/<\s*\|im_start\|>[\s\S]*?<\s*\|im_end\|>/g, '[REDACTED_SPECIAL_TOKEN]');

  // Repeated "do not / never" style injection attempts (larger)
  cleaned = cleaned.replace(/(?:(?:do not|never|ignore|disregard|override|bypass)[\s\S]{0,80}?){2,}/gi, '[REDACTED_INJECTION_ATTEMPT]');

  // Control chars and zero-width that can hide instructions.
  // Preserve structural whitespace (\t \n \r) so legitimate code/files remain usable.
  // Only strip other C0 controls + DEL + zero-width.
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF]/g, '');

  return cleaned;
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

  const contentHash = createHash('sha256').update(raw).digest('hex').substring(0, 16);

  let cleaned = raw;

  // 1. Neutralize syntactic command injection attempts
  cleaned = neutralizeSyntacticMarkers(cleaned);

  // 2. For file/DOM sources, strip common invisible channels
  if (kind === 'repo_file' || kind === 'dom_evidence') {
    cleaned = stripInvisibleHtmlLayers(cleaned);
  }

  // 3. Build the explicit untrusted wrapper with provenance
  // Header uses only safe provenance (per adversarial review). 
  // Do not embed attacker-controlled path text in the header line itself.
  // The original path (if relevant) is associated via the call site (e.g. "FILE #N (hash=...)") 
  // or lives inside the neutralized body for the data block.
  const pathInfo = ''; // path omitted from header; use content_hash + source only for safe metadata in header.
  const wrapped = `${BEGIN_MARKER} (source=${kind}, content_hash=${contentHash}, trust=LOW)
${cleaned}
${END_MARKER}`;

  return {
    sanitized: wrapped,
    provenance: {
      sourceKind: kind,
      originalPath: meta.originalPath,
      trustLevel: 'LOW',
      ingestedAt: new Date().toISOString(),
      contentHash,
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

/**
 * Helper specifically for the file list metadata section (which is attacker-controlled
 * via FS readdir on the untrusted repo). Ensures the entire list is wrapped.
 */
export function sanitizeFileList(files: string[]): SanitizedContent {
  const content = files.join('\n');
  return sanitizeExternalContent(content, 'repo_path', { originalPath: 'file-list' });
}
