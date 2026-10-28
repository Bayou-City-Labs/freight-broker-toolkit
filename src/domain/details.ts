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

export const loadDetailsSchema = z
  .object({
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

export type LoadDetails = z.infer<typeof loadDetailsSchema>;
export type StopDetails = z.infer<typeof stopDetailsSchema>;
export type PartyDetails = z.infer<typeof partyDetailsSchema>;
export type CarrierDetails = z.infer<typeof carrierDetailsSchema>;
export type DocumentDetails = z.infer<typeof documentDetailsSchema>;
