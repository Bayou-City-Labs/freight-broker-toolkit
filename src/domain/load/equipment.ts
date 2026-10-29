import type { EquipmentType } from "./load";

/**
 * Equipment as a document writes it, mapped to the type we store.
 *
 * Rate cons describe equipment in free text — "53' Dry Van", "Reefer -10",
 * "V", "F/B" — and the same trailer gets a different phrase from every
 * dispatcher. Patterns are ordered because the words nest: "reefer van" is a
 * reefer, and "step deck" must be settled before anything matching "deck".
 *
 * Returns null rather than guessing. An unrecognised phrase is kept verbatim
 * on the draft for a human to classify; silently filing it as `other` would
 * lose the distinction between "we read this and it is unusual" and "we could
 * not read this".
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, EquipmentType]> = [
  [/\breefer\b|\brefrigerat|\btemp\s*(?:control|cont)|\breef\b|\br\/?f\b/i, "reefer"],
  [/\bstep\s*-?\s*deck\b|\bstepdeck\b|\bsd\b/i, "step_deck"],
  [/\bflat\s*-?\s*bed\b|\bflatbed\b|\bflat\b|\bf\/?b\b/i, "flatbed"],
  [/\bcontainer\b|\bintermodal\b|\bdray\b|\bimdl\b/i, "container"],
  [/\bpower\s*only\b|\bp\/?o\b/i, "power_only"],
  [/\bdry\s*van\b|\bvan\b|\bdv\b/i, "dry_van"],
];

export function parseEquipmentType(input: string): EquipmentType | null {
  const text = input.trim();
  if (text.length === 0) return null;

  for (const [pattern, type] of PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

const LABELS: Record<EquipmentType, string> = {
  dry_van: "Dry van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  step_deck: "Step deck",
  container: "Container",
  power_only: "Power only",
  other: "Other",
};

export function equipmentLabel(type: EquipmentType): string {
  return LABELS[type];
}
