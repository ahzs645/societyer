export type ImportedMeetingTemplate = {
  name: string;
  description?: string;
  meetingType?: string;
  isDefault: false;
  items: Array<{ title: string; depth?: 0 | 1; sectionType?: string; presenter?: string; details?: string; motionText?: string; adoptsPreviousMinutes?: boolean }>;
};

/** Portable template files contain content only; tenancy and record IDs come
 * from the current workspace, never from a supplied file. */
export function parseMeetingTemplateImport(text: string): ImportedMeetingTemplate {
  if (text.length > 1_000_000) throw new Error("Template JSON must be smaller than 1 MB.");
  const input = JSON.parse(text);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Import one template object per file.");
  const string = (value: unknown, label: string, required = false) => {
    if (value === undefined && !required) return undefined;
    if (typeof value !== "string" || (required && !value.trim())) throw new Error(`${label} must be ${required ? "non-empty " : ""}text.`);
    return value.trim();
  };
  const name = string(input.name, "Template name", true)!;
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 200) throw new Error("A template needs between 1 and 200 agenda items.");
  const items = input.items.map((item: any, index: number) => {
    const label = `Agenda item ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} must be an object.`);
    if (item.motionTemplateId || item.motionId || item.adoptsMinutesId) throw new Error(`${label} contains a workspace record ID. Use motionText and adoptsPreviousMinutes instead.`);
    if (item.depth !== undefined && item.depth !== 0 && item.depth !== 1) throw new Error(`${label} depth must be 0 or 1.`);
    if (index === 0 && item.depth === 1) throw new Error("The first agenda item must be a root item (depth 0).");
    if (item.adoptsPreviousMinutes !== undefined && typeof item.adoptsPreviousMinutes !== "boolean") throw new Error(`${label} adoptsPreviousMinutes must be true or false.`);
    return {
      title: string(item.title, `${label} title`, true)!,
      depth: item.depth as 0 | 1 | undefined,
      sectionType: string(item.sectionType, `${label} type`),
      presenter: string(item.presenter, `${label} presenter`),
      details: string(item.details, `${label} details`),
      motionText: string(item.motionText, `${label} motion`),
      adoptsPreviousMinutes: item.adoptsPreviousMinutes as boolean | undefined,
    };
  });
  return { name, description: string(input.description, "Description"), meetingType: string(input.meetingType, "Meeting type"), isDefault: false, items };
}
