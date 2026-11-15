// Seam (vk lane 0b). Owner: lane 6. Other lanes import, never edit.
import type { OwnerQuestion } from './ownerQuestions';
import { openExternal } from './openExternal';
import { answerQuestion as recordAnswer } from './discussWithMayor';
import { isEmbedded } from './apiBase';

/**
 * UI answer seam («Ответить в Discord» and the choice chips). It opens the
 * Mayor's Discord message synchronously (ruling 3: never await before
 * opening). Inside the Activity only, a choice also fires the wire seam
 * `answerQuestion(qid, choiceIndex)` from lib/discussWithMayor in the
 * background; outside it nothing is posted. Until lane 7 wires it, the
 * rejection is ignored.
 */
export function answerQuestion(
  q: Pick<OwnerQuestion, 'questionId' | 'chatUrl'>,
  choice: number | null,
): void {
  openExternal(q.chatUrl);
  if (choice !== null && isEmbedded()) {
    void recordAnswer(q.questionId, choice).catch(() => undefined);
  }
}
