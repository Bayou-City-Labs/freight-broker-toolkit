import { equipmentLabel } from "@/domain/load/equipment";
import type { EquipmentType, LoadStatus, Stop, StopType } from "@/domain/load/load";
import { Money } from "@/domain/money";
import styles from "../../ui.module.css";

const STATUS_LABEL: Record<LoadStatus, string> = {
  draft: "Draft",
  booked: "Booked",
  dispatched: "Dispatched",
  in_transit: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<LoadStatus, string> = {
  draft: styles.unchecked,
  booked: styles.pass,
  dispatched: styles.pass,
  in_transit: styles.pass,
  delivered: styles.pass,
  cancelled: styles.fail,
};

/** Spelled out rather than colour-coded alone, like the verdict badges. */
export function StatusBadge({ status }: { status: LoadStatus }) {
  return (
    <span className={`${styles.badge} ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const STOP_TYPE_LABEL: Record<StopType, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  empty_return: "Empty return",
};

export function stopTypeLabel(type: StopType): string {
  return STOP_TYPE_LABEL[type];
}

export function formatEquipment(type: EquipmentType | null, asWritten?: string): string {
  if (type === null) return asWritten ?? "Not stated";
  // The document's own phrase alongside the classification: "Reefer" tells a
  // dispatcher less than "Reefer (53' Refrigerated -10F)" when a setpoint was
  // written on the rate con and nothing else captured it.
  const label = equipmentLabel(type);
  return asWritten && asWritten.toLowerCase() !== label.toLowerCase()
    ? `${label} (${asWritten})`
    : label;
}

export function formatMoney(cents: number | null): string {
  return cents === null ? "—" : Money.fromCents(cents).format();
}

export function formatWeight(lbs: number | null): string {
  return lbs === null ? "—" : `${lbs.toLocaleString("en-US")} lbs`;
}

/**
 * A window as the document stated it: wall-clock time with no zone implied.
 *
 * Deliberately not converted to anything. The stop stores naive local time
 * because the document said "0800" and never said where — rendering it as an
 * instant would invent the timezone the whole model exists to avoid.
 */
export function formatWindow(stop: Stop): string {
  if (stop.opensAtLocal === null) return "No time stated";

  const date = formatLocalDate(stop.opensAtLocal);
  const opens = timeOf(stop.opensAtLocal);
  const closes = stop.closesAtLocal ? timeOf(stop.closesAtLocal) : null;
  const zone = stop.timeZone ? "" : " (local time at the dock)";

  return closes
    ? `${date}, ${opens}–${closes}${zone}`
    : `${date}, ${opens} appointment${zone}`;
}

function formatLocalDate(local: string): string {
  const [date] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  // Formatted from the parts, not through a Date: parsing "2026-11-02" as a
  // Date makes it UTC midnight, which renders as the 1st in Houston.
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function timeOf(local: string): string {
  return local.split("T")[1] ?? "";
}
