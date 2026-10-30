/**
 * Separate from `actions.ts` because a `"use server"` module may export **only**
 * async functions. An exported constant there throws `A "use server" file can
 * only export async functions, found object` when the module is evaluated,
 * which takes down whatever rendered it — it typechecks and it builds, and this
 * project has shipped it once already.
 */
export type EditState =
  { readonly status: "idle" } | { readonly status: "error"; readonly message: string };

export const initialEditState: EditState = { status: "idle" };
