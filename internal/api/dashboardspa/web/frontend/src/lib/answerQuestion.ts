// Seam (vk lane 0b). Owner: lane 6. Other lanes import, never edit.
import type { OwnerQuestion } from './ownerQuestions';
import { openExternal } from './openExternal';
import { answerQuestion as recordAnswer } from './discussWithMayor';
import { isEmbedded } from './apiBase';
import { canWrite } from '../embed/activitySession';

/**
 * UI answer seam («Ответить в Discord» and the choice chips). It opens the
 * Mayor's Discord message synchronously (ruling 3: never await before
 * opening). Inside the Activity only, a choice also fires the wire seam
 * `answerQuestion(qid, choiceIndex)` from lib/discussWithMayor in the
 * background; outside it nothing is posted, and a reader (Richard) never
 * posts (Task 6: the UI hides the chips for him via canWrite()). The
 * rejection is ignored here; a caller that shows the outcome calls the wire
 * seam itself and maps it with answerErrorText().
 */
export function answerQuestion(
  q: Pick<OwnerQuestion, 'questionId' | 'chatUrl'>,
  choice: number | null,
): void {
  openExternal(q.chatUrl);
  if (choice !== null && isEmbedded() && canWrite()) {
    void recordAnswer(q.questionId, choice).catch(() => undefined);
  }
}
