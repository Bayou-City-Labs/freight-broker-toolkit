import { z } from "zod";

/**
 * Late-bound fields.
 *
 * The columns on each table cover what every record genuinely has. Everything
 * conditional — reefer setpoints, container and seal numbers, hazmat flags,
 * tarps — lives in a `details` jsonb column instead of twenty mostly-null
 * columns guessing at a workflow discovery hasn't confirmed.
 *
 * This is not a junk drawer: the column is parsed by these schemas at the
 * domain boundary, so reads are typed. Schemas are loose so an extraction that
 * finds something we haven't modelled keeps it rather than dropping it on the
 * floor. When a field starts being queried, sorted, or filtered on, promote it
 * to a real column.
 */

export const temperatureSchema = z.object({
  minF: z.number().optional(),
  maxF: z.number().optional(),
  continuous: z.boolean().optional(),
});

/**
 * How a load got here, when it came from a document rather than a keyboard.
 *
 * Lives on `details` rather than in columns because nothing queries it yet —
 * it is read on one load at a time, and in bulk only when someone sits down to
 * calibrate confidences. Promote it the day a screen filters on it.
 *
 * `textSource` mirrors `TextSource` in `intake/document-text.ts`. The two are
 * linked by the compiler rather than by comment: provenance is built from a
 * `DocumentText`, so a new source there fails to type-check here until it is
 * added.
 */
export const fieldCorrectionSchema = z.object({
  /** Dotted path, matching `flaggedFields`: "weightLbs", "stops.0.date". */
  path: z.string(),
  /** What the parser claimed before a human overruled it. */
  confidence: z.number().min(0).max(1),
});

export const intakeProvenanceSchema = z
  .object({
    producedBy: z.string().min(1),
    textSource: z.enum(["pdf-text", "ocr", "plain-text"]),
    filename: z.string().nullable(),
    corrections: z.array(fieldCorrectionSchema),
    acceptedFlagged: z.array(z.string()),
  })
  .loose();

export const loadDetailsSchema = z
  .object({
    intake: intakeProvenanceSchema.optional(),
    /** The equipment phrase the document used, before classification. */
    equipmentAsWritten: z.string().optional(),
    /** The carrier name as the document wrote it, which may not match a record. */
    carrierAsWritten: z.string().optional(),
    temperature: temperatureSchema.optional(),
    hazmat: z.boolean().optional(),
    hazmatClass: z.string().optional(),
    palletCount: z.number().int().nonnegative().optional(),
    pieceCount: z.number().int().nonnegative().optional(),
    tarpRequired: z.boolean().optional(),
    teamRequired: z.boolean().optional(),
    containerNumber: z.string().optional(),
    chassisNumber: z.string().optional(),
    bookingNumber: z.string().optional(),
    notes: z.string().optional(),
  })
  .loose();

export const stopDetailsSchema = z
  .object({
    sealNumber: z.string().optional(),
    appointmentNumber: z.string().optional(),
    driverAssist: z.boolean().optional(),
    dockHours: z.string().optional(),
    notes: z.string().optional(),
  })
  .loose();

export const partyDetailsSchema = z
  .object({
    receivingHours: z.string().optional(),
    notes: z.string().optional(),
  })
  .loose();

export const carrierDetailsSchema = z
  .object({
    phone: z.string().optional(),
    email: z.email().optional(),
    physicalAddress: z.string().optional(),
    notes: z.string().optional(),
  })
  .loose();

export const documentDetailsSchema = z
  .object({
    templateVersion: z.string().optional(),
    notes: z.string().optional(),
  })
  .loose();

export type FieldCorrection = z.infer<typeof fieldCorrectionSchema>;
export type IntakeProvenance = z.infer<typeof intakeProvenanceSchema>;
export type LoadDetails = z.infer<typeof loadDetailsSchema>;
export type StopDetails = z.infer<typeof stopDetailsSchema>;
export type PartyDetails = z.infer<typeof partyDetailsSchema>;
export type CarrierDetails = z.infer<typeof carrierDetailsSchema>;
export type DocumentDetails = z.infer<typeof documentDetailsSchema>;
