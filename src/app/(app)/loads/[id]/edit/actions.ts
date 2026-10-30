"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateLoad } from "@/server/intake";
import { getCurrentBrokerage } from "@/server/tenant";
import { readEditedLoad } from "../../form-values";
import type { EditState } from "./form-state";

/**
 * Saving an edit.
 *
 * Checks the session itself: the `(app)` route group's layout renders for a
 * page request and does not run for a server action, so it is no guard here.
 * The load id travels in a hidden field rather than from the route, because an
 * action has no params.
 */
export async function editLoadAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const scope = await getCurrentBrokerage();
  if (!scope)
    return { status: "error", message: "You are not signed in to a brokerage." };

  const loadId = String(formData.get("loadId") ?? "");
  if (!loadId) return { status: "error", message: "This edit lost its load." };

  const read = readEditedLoad(formData);
  if (!read.ok) return { status: "error", message: read.message };

  const outcome = await updateLoad(scope, loadId, read.edited);

  if (outcome.status === "not_found") {
    return { status: "error", message: "This load no longer exists." };
  }

  if (outcome.status === "duplicate_reference") {
    return {
      status: "error",
      message: `Load ${outcome.existing.referenceNumber} already exists. Use a different load number.`,
    };
  }

  revalidatePath("/loads");
  revalidatePath(`/loads/${loadId}`);
  redirect(`/loads/${loadId}`);
}
