import { loadDriveFaults } from "@/lib/drives/faults";
import { computeFocus, type FocusEntry } from "@/lib/profile/focus";

export async function loadFocus(userId: string): Promise<{ focus: FocusEntry[]; drivesCount: number }> {
  const faults = await loadDriveFaults(userId);
  return { focus: computeFocus(faults), drivesCount: faults.length };
}
