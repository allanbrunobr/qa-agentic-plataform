export interface LogEvent {
  type:
    | 'step_start'
    | 'step_pass'
    | 'step_fail'
    | 'finding'
    | 'persona_action'
    | 'system'
    | 'error';
  timestamp: string;
  persona?: string;
  step?: string;
  message: string;
  duration?: number;
  severity?: string;
  raw: string;
}

const PERSONA_NAMES = ['Ana', 'Carlos', 'Roberto', 'Fernanda', 'Juliana'] as const;

const TIMESTAMP_RE = /^\[(\d{2}:\d{2}:\d{2})\]/;
const DURATION_SECONDS_RE = /\((\d+\.?\d*)s\)/;
const DURATION_MS_RE = /\((\d+)ms\)/;
const FINDING_ID_RE = /F\d{3}/;

function extractTimestamp(line: string): string {
  const match = TIMESTAMP_RE.exec(line);
  return match?.[1] ?? new Date().toISOString();
}

function extractDuration(line: string): number | undefined {
  const secMatch = DURATION_SECONDS_RE.exec(line);
  if (secMatch?.[1]) {
    return Math.round(parseFloat(secMatch[1]) * 1000);
  }
  const msMatch = DURATION_MS_RE.exec(line);
  if (msMatch?.[1]) {
    return parseInt(msMatch[1], 10);
  }
  return undefined;
}

function detectPersona(line: string): string | undefined {
  for (const name of PERSONA_NAMES) {
    if (line.includes(name)) {
      return name === 'Ana' ? 'Ana Silva' : name;
    }
  }
  return undefined;
}

export function parseLogLine(line: string): LogEvent {
  const raw = line;
  const timestamp = extractTimestamp(line);
  const duration = extractDuration(line);
  const persona = detectPersona(line);

  // Error lines from stderr
  if (line.startsWith('[stderr]') || line.startsWith('[error]')) {
    return {
      type: 'error',
      timestamp,
      persona,
      message: line.replace(/^\[(stderr|error)\]\s*/, ''),
      duration,
      raw,
    };
  }

  // Finding lines
  if (line.includes('Finding') || FINDING_ID_RE.test(line)) {
    const severityMatch = /\b(critical|high|medium|low|info)\b/i.exec(line);
    return {
      type: 'finding',
      timestamp,
      persona,
      message: line,
      duration,
      severity: severityMatch?.[1]?.toLowerCase(),
      raw,
    };
  }

  // Step pass indicators
  const trimmed = line.trim();
  if (
    trimmed.includes('\u2713') ||
    /\bPASS(ED)?\b/i.test(trimmed) ||
    /\bpassed\b/.test(trimmed)
  ) {
    return {
      type: 'step_pass',
      timestamp,
      persona,
      step: trimmed,
      message: trimmed,
      duration,
      raw,
    };
  }

  // Step fail indicators
  if (
    trimmed.includes('\u2717') ||
    /\bFAIL(ED)?\b/i.test(trimmed) ||
    /\bfailed\b/.test(trimmed)
  ) {
    return {
      type: 'step_fail',
      timestamp,
      persona,
      step: trimmed,
      message: trimmed,
      duration,
      raw,
    };
  }

  // Persona action (line mentions a persona but isn't pass/fail/finding)
  if (persona) {
    return {
      type: 'persona_action',
      timestamp,
      persona,
      message: trimmed,
      duration,
      raw,
    };
  }

  // Default: system line
  return {
    type: 'system',
    timestamp,
    message: trimmed,
    duration,
    raw,
  };
}
