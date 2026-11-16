import type { SupervisorBead } from '../../supervisor/beadReads';

// polish2 16.11 (owner screenshots, item 8): the live card dw-11d21b41c8f56781
// as the supervisor serves it (metadata dropped). Its description is Markdown:
// **bold** lead-ins, a ### heading and line breaks inside paragraphs.
export const DISPATCH_CARD: SupervisorBead = {
  id: 'dw-11d21b41c8f56781',
  title: 'm03-d3-fixed-dispatch — фиксированный диспатч провайдера, Task 3 (HIGH, после d2)',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  created_at: '2026-10-28T13:09:12Z',
  updated_at: '2026-11-11T10:32:09Z',
  parent: 'dw-eba63b7db1e9a14e',
  labels: ['milestone:M03'],
  dependencies: [
    {
      issue_id: 'dw-11d21b41c8f56781',
      depends_on_id: 'dw-eba63b7db1e9a14e',
      type: 'parent-child',
    },
    {
      issue_id: 'dw-11d21b41c8f56781',
      depends_on_id: 'dw-76d30a7621ef3a49',
      type: 'blocks',
    },
  ],
  is_blocked: true,
  description:
    '**Что меняем и зачем:** m03-d3-fixed-dispatch — фиксированный диспатч провайдера, Task 3 (HIGH, после d2)\n**Как поймём, что готово:** Критерии исходного пункта и связанные критерии этапа; перенос записи не заменяет проверку результата.\n**Сейчас:** Импорт удержан. Историческое состояние: pending. Источник обновлён 2026-10-28T13:09:11.869Z.\n**Следующий шаг и ответственный:** Координатор сверяет источник и зависимости; исполнитель не назначен.\n**Что мешает:** Нет допуска импортированной области; готовность не установлена.\n**Нужно от владельца:** Из импорта новый вопрос не возникает; конкретные открытые решения сохраняются в исходнике.\n\n### Исходные сведения и технические ссылки\nИсторический источник; не действующее поручение. При конфликте применяются текущие решения v1.7.\nИсходная карточка: agent-teams/devwork:3dd87dd5-8ae2-51f7-8654-b7c83e98da42\nФайл: /Users/tombohomolov/.claude/tasks/devwork/3dd87dd5-8ae2-51f7-8654-b7c83e98da42.json\nSHA-256: aa34104b54a94f6baca129254f866550435cf11b3aff4dd8afe740d54d94624a\nИсходный заголовок: m03-d3-fixed-dispatch — фиксированный диспатч провайдера, Task 3 (HIGH, после d2)\n\nИсходное описание (дословно):\nTask id: m03-d3-fixed-dispatch. Risk HIGH. Blocked by m03-d2-provider-binding. Spec: masterSDD/m03-provider-composition-plan.md#task-3; criteria C1–C5 + files_allow in masterSDD/conveyor/waves/M03-w2.yaml. Base: integration head after d2 (lead fills in at dispatch).',
} as SupervisorBead;
