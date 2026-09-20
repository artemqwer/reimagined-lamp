// Preset questions are stored in a prompt's `content` field. Each item has the
// visible `question` plus an optional hidden `description` (AI instructions).
//
// Backward compatible: legacy content is a plain newline list (one question per
// line, no description). New content is a JSON array of { q, d }. This module is
// client-safe (no server-only imports) so both the API route and the Admin UI use it.

export interface PresetQuestion {
  question: string;
  description: string;
}

export function parsePresetQuestions(content: string | null | undefined): PresetQuestion[] {
  const trimmed = (content ?? "").trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return (
          arr
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((x: any) => ({
              question: String(x?.q ?? x?.question ?? "").trim(),
              description: String(x?.d ?? x?.description ?? "").trim(),
            }))
            .filter((x) => x.question)
        );
      }
    } catch {
      /* not JSON → fall through to line parsing */
    }
  }
  return trimmed
    .split("\n")
    .map((l) => ({ question: l.trim(), description: "" }))
    .filter((x) => x.question);
}

export function serializePresetQuestions(items: PresetQuestion[]): string {
  // Keep raw values (don't trim) so editing in the admin isn't disrupted; the
  // read side (parsePresetQuestions) trims when serving. Drop blank questions.
  const cleaned = items
    .map((x) => ({ q: x.question ?? "", d: x.description ?? "" }))
    .filter((x) => x.q.trim());
  return JSON.stringify(cleaned);
}
