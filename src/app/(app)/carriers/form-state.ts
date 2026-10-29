/**
 * Form state for the vetting screen, and its initial value.
 *
 * Separate from `actions.ts` because a `"use server"` module may export
 * **only** async functions. Exporting a constant from one makes Next throw
 * `A "use server" file can only export async functions, found object` when the
 * module is evaluated, which takes down whatever rendered it.
 */
export type VetFormState =
  | { readonly status: "idle" }
  /** A finding: the provider answered, and has no such carrier. */
  | { readonly status: "not_found"; readonly message: string }
  /** We could not get an answer. Deliberately worded so it can't read as a pass. */
  | { readonly status: "error"; readonly message: string };

export const initialVetFormState: VetFormState = { status: "idle" };
