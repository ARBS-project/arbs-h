// ARBS-H UI1b: log viewer helpers (H-TRBL-07, H-V2LOG-01..03, H-HOME-11).

export type Severity = 'all' | 'error' | 'warning' | 'info' | 'debug';
export const LOG_SOURCES = ['sunshine', 'display_helper', 'wgc'] as const;

export interface LogLine {
  index: number;
  text: string;
  level: Exclude<Severity, 'all'>;
}

export function lineLevel(text: string): LogLine['level'] {
  const head = text.slice(0, 64).toLowerCase();
  if (/\b(fatal|error)\b/.test(head)) return 'error';
  if (/\bwarning\b|\bwarn\b/.test(head)) return 'warning';
  if (/\b(debug|verbose|trace)\b/.test(head)) return 'debug';
  return 'info';
}

export function parseLog(content: string): LogLine[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((text, index) => ({ index, text, level: lineLevel(text) }));
}

export function filterLines(lines: LogLine[], severity: Severity): LogLine[] {
  if (severity === 'all') return lines;
  if (severity === 'warning') return lines.filter((l) => l.level === 'warning' || l.level === 'error');
  return lines.filter((l) => l.level === severity);
}

export function matchIndexes(lines: LogLine[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (line.text.toLowerCase().includes(q)) out.push(i);
  });
  return out;
}

/** Next/previous match position, wrapping around. */
export function stepMatch(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

export function summary(lines: LogLine[]): { errors: number; warnings: number; total: number } {
  let errors = 0;
  let warnings = 0;
  for (const line of lines) {
    if (line.level === 'error') errors++;
    else if (line.level === 'warning') warnings++;
  }
  return { errors, warnings, total: lines.length };
}

/** Start-up "Fatal:" lines shown on the status card (H-HOME-11). */
export function fatalLines(content: string, limit = 5): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /\bFatal:/.test(line))
    .slice(-limit);
}
