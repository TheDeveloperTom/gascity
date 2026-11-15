// Seam stub (vk lane 0b). Owner: lane 6. Other lanes import, never edit.
import type { OwnerQuestion } from './ownerQuestions';
import { openExternal } from './openExternal';

/** Answer seam: today opens the Mayor's Discord message; later the Activity answers in place. */
export function answerQuestion(
  q: Pick<OwnerQuestion, 'questionId' | 'chatUrl'>,
  _choice: number | null,
): void {
  openExternal(q.chatUrl);
}
