import type { RuPlural } from './ru';

// vk/health (owner 16.11): the realtime Health page. Russian keyed by the
// English source string; only this lane adds keys here.
export const RU_HEALTH: Readonly<Record<string, string | RuPlural>> = {
  // Units
  B: 'Б',
  KB: 'КБ',
  MB: 'МБ',
  GB: 'ГБ',
  TB: 'ТБ',

  // Headline
  'The CPU is {busy} busy': 'Процессор занят на {busy}',
  'The Mac is overloaded: the CPU is {busy} busy, work waits in a queue ({times} the cores)':
    'Мак перегружен: процессор занят на {busy}, задачи ждут в очереди ({times} ядер)',
  'The Mac is busy: the CPU is {busy} busy': 'Мак загружен: процессор занят на {busy}',
  'The Mac is busy: the CPU is {busy} busy, work waits in a queue ({times} the cores)':
    'Мак загружен: процессор занят на {busy}, задачи ждут в очереди ({times} ядер)',
  'The Mac is overloaded: the CPU is {busy} busy': 'Мак перегружен: процессор занят на {busy}',
  '{x}×': { one: 'в {x} раз больше', few: 'в {x} раза больше', many: 'в {x} раз больше' },
  'work queue: {times} the cores ({load} for {cores})':
    'очередь задач: {times}, чем ядер ({load} на {cores})',
  'work queue: {load} for {cores} cores': 'очередь задач: {load} на {cores} ядер',
  'memory is fine': 'памяти хватает',
  'memory is tight': 'памяти впритык',
  'memory is running out': 'память на исходе',
  '{free} free on disk': 'на диске свободно {free}',
  'disk space is low — {free}': 'на диске мало места — {free}',
  'the disk is almost full — {free} left': 'диск почти заполнен — осталось {free}',
  'The Mac is not reporting its load right now.': 'Мак сейчас не сообщает о нагрузке.',

  // Page frame
  Calm: 'Спокойно',
  Attention: 'Внимание',
  Alarm: 'Тревога',
  'Live, every {s} s': 'Обновляется каждые {s} с',
  'Chart window': 'Окно графиков',
  '{n} min': '{n} мин',
  'Reading the Mac…': 'Читаю, что с Маком…',
  'The live reading failed: {error}': 'Не удалось прочитать нагрузку: {error}',
  'The city database is bloated: {size} for {rows} — it can be compacted (needs your «yes»).':
    'База города раздута: {size} на {rows} — можно сжать (нужно твоё «да»).',

  // Charts
  CPU: 'Процессор',
  Memory: 'Память',
  Disk: 'Диск',
  now: 'сейчас',
  '−{n} min': '−{n} мин',
  'Collecting data…': 'Собираю данные…',
  busy: 'занят',
  used: 'занято',
  '{used} of {total}': '{used} из {total}',
  'memory pressure: normal': 'давление памяти в норме',
  'memory pressure: elevated': 'давление памяти повышено',
  'memory pressure: critical': 'давление памяти критическое',
  'memory pressure: not reported': 'давление памяти не сообщается',
  'swap in use: {swap}': 'в файле подкачки: {swap}',
  '{free} free': '{free} свободно',
  '{free} left': 'осталось {free}',
  'busy right now, share of all {n} cores': 'занят прямо сейчас, доля всех {n} ядер',
  '{pct} of {total} used': 'занято {pct} из {total}',

  // Who eats the Mac
  'Who eats the Mac': 'Кто ест Мак',
  '{n} processes': { one: '{n} процесс', few: '{n} процесса', many: '{n} процессов' },
  'Reading…': 'Читаю…',
  'The process list is visible only on the Mac itself (127.0.0.1).':
    'Список процессов виден только на самом Маке (127.0.0.1).',
  'The process list could not be read just now.': 'Список процессов сейчас прочитать не удалось.',
  'By CPU': 'По процессору',
  'By memory': 'По памяти',
  'Stores (dolt, bd)': 'Хранилища (dolt, bd)',
  'Supervisor and tmux': 'Супервизор и tmux',
  'Builds and tools': 'Сборки и инструменты',
  Browsers: 'Браузеры',
  'Everything else': 'Всё остальное',
  'Heaviest right now': 'Тяжелее всех сейчас',
  'System and the rest (not visible per process)': 'Система и прочее (не видно по процессам)',
  'the macOS kernel and processes that came and went between samples':
    'ядро macOS и процессы, мелькнувшие между замерами',
  'system and other users’ processes are not visible without administrator rights':
    'процессы системы и других пользователей без прав администратора не видны',

  // The city, below
  Supervisor: 'Супервизор',
  Tools: 'Инструменты',
  'Task stores': 'Хранилища задач',
  'City database': 'База города',
  'running {d}': 'работает {d}',
  version: 'версия',
  '{d} d {h} h': '{d} д {h} ч',
  '{h} h {m} min': '{h} ч {m} мин',
  '{m} min': '{m} мин',
  '{s} s': '{s} с',
  fine: 'в порядке',
  warnings: 'есть предупреждения',
  'not working': 'не работает',
  'No store reading yet': 'Замеров хранилищ ещё нет',
  'Not reported by the supervisor': 'Супервизор не сообщает',
  '{n} rows': { one: '{n} запись', few: '{n} записи', many: '{n} записей' },
  'open {open}, ready {ready}, in progress {inProgress}':
    'задач: открыто {open}, готово {ready}, в работе {inProgress}',
  'The size trend is not kept: bd owns these stores, so this is expected.':
    'Тренд размера базы не ведётся: хранилищами управляет bd — так и должно быть.',
  'not found': 'не найден',
  'did not answer': 'не ответил',
};
