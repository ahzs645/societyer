export type ElectionQuestionInput = {
  title: string;
  description?: string;
  maxSelections: number;
  options: { id: string; label: string; memberId?: string; statement?: string }[];
};

export function validateElectionQuestion(question: ElectionQuestionInput) {
  if (!question.title.trim()) throw new Error("Enter a ballot question.");
  if (!question.options.length) throw new Error("Add at least one ballot option.");
  if (question.options.length < 2) {
    throw new Error("Add at least two ballot options. For a single candidate, offer \"For\" and \"Against\", or record the acclamation in the minutes.");
  }
  const labels = new Set<string>();
  for (const option of question.options) {
    const key = option.label.trim().toLowerCase().replace(/\s+/g, " ");
    if (labels.has(key)) throw new Error(`The option "${option.label.trim()}" is listed twice. Each ballot option must be different.`);
    labels.add(key);
  }
  if (!Number.isInteger(question.maxSelections) || question.maxSelections < 1 || question.maxSelections > question.options.length) {
    throw new Error("The selection limit must be between one and the number of options.");
  }
  const ids = new Set<string>();
  for (const option of question.options) {
    if (!option.id.trim() || !option.label.trim()) throw new Error("Every ballot option needs an identifier and label.");
    if (ids.has(option.id)) throw new Error("Ballot option identifiers must be unique.");
    ids.add(option.id);
  }
}

export function normalizeElectionWindow(start: string, end: string, label: string) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw new Error(`Enter valid ${label} opening and closing dates.`);
  if (endTime <= startTime) throw new Error(`${label} must close after it opens.`);
  return { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() };
}
