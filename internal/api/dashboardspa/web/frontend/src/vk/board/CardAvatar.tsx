// vk11 card lane (16.11): the canvas card's assignee avatar (Cards / Main):
// «А» ты on the panel colour, «И» Исполнитель blue, «Р» Ричард teal.
// owner 17.11: `sm` is the small «кто работает сейчас» mark beside the owner.
import { cn } from '../cn';

/** Canvas assignee avatar: 20 px circle, 11 px semibold letter (`sm`: 16 px, 9 px). */
export function CardAvatar({
  letter,
  label,
  tone,
  size = 'md',
}: {
  letter: string;
  label: string;
  tone: 'owner' | 'executor' | 'peer';
  size?: 'md' | 'sm';
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-avatar={tone}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'md' ? 'h-5 w-5 text-[11px]' : 'h-4 w-4 text-[9px] opacity-80',
        tone === 'owner' && 'bg-vk-bg-panel text-vk-text-high',
        tone === 'executor' && 'bg-[#1D5BD6] text-white',
        tone === 'peer' && 'bg-[#0F766E] text-white',
      )}
    >
      {letter}
    </span>
  );
}
