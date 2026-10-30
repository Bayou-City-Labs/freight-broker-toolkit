import type { LoadDetails, PartyDetails, StopDetails } from "../details";
import type { AppointmentType, LocalDateTime } from "../time-window";

/**
 * Domain shapes for loads, their stops, and the facilities those stops touch.
 *
 * These vocabularies used to live in the Drizzle schema, which made them
 * unreachable from the domain — `src/domain/**` cannot import `src/db/**`, by
 * lint rule. They are business vocabulary, not storage detail: a parser
 * deciding that "53' reefer" means a reefer is domain logic that should never
 * need a database on the import path. The schema now reads them from here, the
 * same way it already reads `AppointmentType` and the `details` schemas.
 */

export const LOAD_STATUSES = [
  "draft",
  "booked",
  "dispatched",
  "in_transit",
  "delivered",
  "cancelled",
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

export const EQUIPMENT_TYPES = [
  "dry_van",
  "reefer",
  "flatbed",
  "step_deck",
  "container",
  "power_only",
  "other",
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const STOP_TYPES = ["pickup", "delivery", "empty_return"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** A shipper, consignee, or other facility. Modelled once, referenced from stops. */
export interface Party {
  readonly id: string;
  readonly brokerageId: string;
  readonly name: string;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  /** State or province. */
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly country: string;
  readonly timeZone: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly details: PartyDetails;
}

export interface NewParty {
  readonly name: string;
  readonly addressLine1?: string | null;
  readonly addressLine2?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly postalCode?: string | null;
  readonly country?: string;
  readonly timeZone?: string | null;
  readonly contactName?: string | null;
  readonly contactPhone?: string | null;
  readonly contactEmail?: string | null;
  readonly details?: PartyDetails;
}

export interface Load {
  readonly id: string;
  readonly brokerageId: string;
  /** The brokerage's own load number, as it appears on their paperwork. */
  readonly referenceNumber: string;
  readonly status: LoadStatus;
  readonly equipmentType: EquipmentType | null;
  readonly commodityDescription: string | null;
  readonly weightLbs: number | null;
  /** What the shipper pays the broker, in integer cents. */
  readonly customerRateCents: number | null;
  /** What the broker pays the carrier, in integer cents. Margin is the difference. */
  readonly carrierPayCents: number | null;
  readonly carrierId: string | null;
  readonly details: LoadDetails;
}

export interface NewLoad {
  readonly referenceNumber: string;
  readonly status?: LoadStatus;
  readonly equipmentType?: EquipmentType | null;
  readonly commodityDescription?: string | null;
  readonly weightLbs?: number | null;
  readonly customerRateCents?: number | null;
  readonly carrierPayCents?: number | null;
  readonly carrierId?: string | null;
  readonly details?: LoadDetails;
}

/**
 * An ordered event on a load. Windows are naive local wall time plus the
 * facility's zone and the source text, per the time-window rule.
 */
export interface Stop {
  readonly id: string;
  readonly brokerageId: string;
  readonly loadId: string;
  readonly sequence: number;
  readonly type: StopType;
  readonly partyId: string;
  readonly opensAtLocal: LocalDateTime | null;
  readonly closesAtLocal: LocalDateTime | null;
  readonly timeZone: string | null;
  readonly appointmentType: AppointmentType | null;
  /** Exactly what the source document said about timing, for audit. */
  readonly windowRawText: string | null;
  readonly details: StopDetails;
}

export interface NewStop {
  readonly sequence: number;
  readonly type: StopType;
  readonly partyId: string;
  readonly opensAtLocal?: LocalDateTime | null;
  readonly closesAtLocal?: LocalDateTime | null;
  readonly timeZone?: string | null;
  readonly appointmentType?: AppointmentType | null;
  readonly windowRawText?: string | null;
  readonly details?: StopDetails;
}

/** A load with its stops in sequence, which is how every screen wants it. */
export interface LoadWithStops {
  readonly load: Load;
  readonly stops: readonly Stop[];
}

/**
 * The input to an update, as distinct from a create.
 *
 * `status` and `details` are required here where both are optional on
 * `NewLoad`, and that is deliberate rather than tidy. An update is a **total
 * write**: every column the caller omits is written as null, or as the
 * fallback `create` would have used. For `status` that silently demotes a
 * booked load to a draft; for `details` it discards `intake` — the only
 * evidence the confidence scale can ever be calibrated from — and `edits`, the
 * audit trail, neither of which can be reconstructed. Making both required
 * means the compiler asks the question instead.
 *
 * Every other field is still optional and still overwritten, so a caller
 * holding a partial load has to restate it rather than patch it.
 */
export interface LoadUpdate extends NewLoad {
  readonly status: LoadStatus;
  readonly details: LoadDetails;
}

/**
 * A stop on its way into the database. An `id` means "this row already exists,
 * keep it"; its absence means a stop someone added.
 */
export type StopWrite = NewStop & { readonly id?: string };
