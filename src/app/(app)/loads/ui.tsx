import type { LoadEdit } from "@/domain/details";
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

/**
 * What has changed since this load was saved.
 *
 * On the screen rather than only in the column, for the same reason the intake
 * note is: a rate con is an agreement, and "the carrier pay says $1,850 — did
 * it always?" is a question someone eventually asks. Newest first, since the
 * usual question is about the last change — but every save is shown, because
 * nobody has yet seen a load with enough edits to need collapsing. Revisit
 * when one does.
 *
 * Lives here rather than on the detail page so it can be rendered in a test:
 * the page itself is an async server component, and this is the part of it
 * whose correctness is not about data loading.
 */
export function EditNote({ edits }: { edits: readonly LoadEdit[] }) {
  const newest = [...edits].reverse();

  return (
    <div className={styles.note}>
      <strong>
        Edited {edits.length === 1 ? "once" : `${edits.length} times`} since it was saved.
      </strong>
      <ul className={styles.list}>
        {newest.map((edit, index) => (
          <li key={`${edit.at}-${index}`} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowName}>{formatEditedAt(edit.at)}</span>
              {/*
                One line per change, not a joined sentence. A single swap of
                two stops is sixteen positional changes, and as one paragraph
                that ran taller than the Route section it described.
              */}
              {edit.changes.length === 0 ? (
                <span className={styles.rowMeta}>No fields changed.</span>
              ) : (
                <ul className={styles.changeList}>
                  {edit.changes.map((change, position) => (
                    <li key={`${change.path}-${position}`} className={styles.rowMeta}>
                      {editChangeLabel(change.path)}: {change.from ?? "—"} →{" "}
                      {change.to ?? "—"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The instant an edit was made, in the reader's own zone — unlike a dock
 * window, which is wall time the document stated and no zone of ours.
 *
 * `timeZone` exists so a test can pin the output; production passes nothing,
 * which is the whole point of rendering an instant.
 */
export function formatEditedAt(at: string, timeZone?: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("en-US", {
    // The year is not decoration on an audit trail: without it an edit made
    // last January is indistinguishable from one made this morning.
    year: "numeric",
    month: "short",
    day: "numeric",
    // 24-hour, like the dock windows further up the page. The windows are the
    // half that cannot move: they are wall-clock strings the document stated,
    // and reformatting them means parsing a time whose zone we deliberately
    // do not know.
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
}

/**
 * A stored change path, in the words the form uses.
 *
 * Mapped at read time on purpose: the stored `path` stays the stable
 * machine-readable key, so improving a label later improves every entry
 * already written. An unmapped path renders verbatim rather than being
 * dropped — a trail that hides a change it cannot name is the failure this
 * whole block exists to avoid.
 */
export function editChangeLabel(path: string): string {
  const direct = LOAD_FIELD_LABEL[path];
  if (direct) return direct;

  const stop = /^stops\.(\d+)(?:\.(.+))?$/.exec(path);
  if (!stop) return path;

  // 1-based, like the numbering on the route itself.
  const number = Number(stop[1]) + 1;
  if (stop[2] === undefined) return `Stop ${number}`;

  const field = STOP_FIELD_LABEL[stop[2]];
  return field ? `Stop ${number} ${field}` : path;
}

/** Keyed by the stored path, valued with the form's own label. */
const LOAD_FIELD_LABEL: Record<string, string> = {
  referenceNumber: "Load number",
  carrierName: "Carrier",
  // Not a form field: the MC and USDOT boxes resolve to one link, and the link
  // is what separates a checked carrier from an unchecked one.
  carrierId: "Vetted carrier",
  commodityDescription: "Commodity",
  weightLbs: "Weight (lbs)",
  equipmentAsWritten: "Equipment",
  carrierPayCents: "Carrier rate",
  stops: "Stops",
};

const STOP_FIELD_LABEL: Record<string, string> = {
  kind: "type",
  partyName: "name",
  addressLine: "address",
  city: "city",
  state: "state",
  postalCode: "ZIP",
  date: "date",
  windowStart: "window opens",
  windowEnd: "window closes",
  referenceNumber: "reference number",
};
