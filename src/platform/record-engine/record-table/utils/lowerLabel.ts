/** "Meeting templates" → "meeting templates", but "API clients" and "PIPA training" keep their acronyms. */
export function lowerLabel(label: string) {
  return label.replace(/\b([A-Z])([a-z])/g, (_, first: string, next: string) => first.toLowerCase() + next);
}
