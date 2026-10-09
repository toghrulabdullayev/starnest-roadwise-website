import { loadDriveFaults } from "@/lib/drives/faults";
import { computeFocus, type FocusEntry } from "@/lib/profile/focus";
import { loadQuizFaults } from "@/lib/quiz/store";

export async function loadFocus(userId: string): Promise<{ focus: FocusEntry[]; drivesCount: number }> {
  const [faults, quizzes] = await Promise.all([loadDriveFaults(userId), loadQuizFaults(userId)]);
  return { focus: computeFocus(faults, quizzes), drivesCount: faults.length };
}
