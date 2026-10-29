import { describe, expect, it } from "vitest";
import { equipmentLabel, parseEquipmentType } from "./equipment";

describe("parseEquipmentType", () => {
  it("reads the phrases rate cons actually use", () => {
    expect(parseEquipmentType("53' Dry Van")).toBe("dry_van");
    expect(parseEquipmentType("VAN")).toBe("dry_van");
    expect(parseEquipmentType("Reefer")).toBe("reefer");
    expect(parseEquipmentType("Refrigerated 53")).toBe("reefer");
    expect(parseEquipmentType("Temp Control -10F")).toBe("reefer");
    expect(parseEquipmentType("48' Flatbed")).toBe("flatbed");
    expect(parseEquipmentType("Step Deck")).toBe("step_deck");
    expect(parseEquipmentType("stepdeck")).toBe("step_deck");
    expect(parseEquipmentType("40' Container")).toBe("container");
    expect(parseEquipmentType("Power Only")).toBe("power_only");
  });

  it("settles the nested words in the right order", () => {
    // Both halves match a pattern; the cooling unit is the load-bearing fact.
    expect(parseEquipmentType("Reefer Van")).toBe("reefer");
    // Without ordering this matches flatbed, since a step deck is a flat deck.
    expect(parseEquipmentType("Step Deck / Flatbed")).toBe("step_deck");
  });

  it("returns null for anything it does not recognise", () => {
    // Real equipment, deliberately unmapped: filing it as `other` would lose
    // the difference between an unusual trailer and an unreadable field.
    expect(parseEquipmentType("Conestoga")).toBeNull();
    expect(parseEquipmentType("hotshot")).toBeNull();
    expect(parseEquipmentType("")).toBeNull();
    expect(parseEquipmentType("   ")).toBeNull();
  });

  it("labels every type", () => {
    expect(equipmentLabel("dry_van")).toBe("Dry van");
    expect(equipmentLabel("power_only")).toBe("Power only");
  });
});
