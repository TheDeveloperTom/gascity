// Seam stub (vk lane 0b). Owner: lane 2 (lane 3 consumes it). No states yet.
import { discussWithMayor, mayorChannelUrl, type DiscussContext } from '../lib/discussWithMayor';
import { openExternal } from '../lib/openExternal';

export interface DiscussButtonProps {
  ctx: DiscussContext;
  className?: string;
}

export function DiscussButton({ ctx, className }: DiscussButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={mayorChannelUrl() === null}
      onClick={() => {
        void discussWithMayor(ctx).then(openExternal);
      }}
    >
      Обсудить в Discord
    </button>
  );
}
