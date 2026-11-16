// vk11 card lane (16.11): the canvas card's assignee avatar (Cards / Main):
// «А» ты on the panel colour, «И» Исполнитель blue, «Р» Ричард teal.
import { cn } from '../cn';

/** Canvas assignee avatar: 20 px circle, 11 px semibold letter. */
export function CardAvatar({ letter, label, tone }: { letter: string; label: string; tone: 'owner' | 'executor' | 'peer' }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-avatar={tone}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        tone === 'owner' && 'bg-vk-bg-panel text-vk-text-high',
        tone === 'executor' && 'bg-[#1D5BD6] text-white',
        tone === 'peer' && 'bg-[#0F766E] text-white',
      )}
    >
      {letter}
    </span>
  );
}
