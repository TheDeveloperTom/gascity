// Seam stub (vk lane 0b). Owner: lane 2 (lane 3 consumes it). No states yet.
// Task 6: hidden for an Activity reader (Richard); inside the Activity the
// gateway resolves the Discord URL, so VITE_MAYOR_DISCORD_URL is not needed.
import { discussWithMayor, mayorChannelUrl, type DiscussContext } from '../lib/discussWithMayor';
import { openExternal } from '../lib/openExternal';
import { isEmbedded } from '../lib/apiBase';
import { canWrite } from '../embed/activitySession';

export interface DiscussButtonProps {
  ctx: DiscussContext;
  className?: string;
}

export function DiscussButton({ ctx, className }: DiscussButtonProps) {
  if (!canWrite()) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={!isEmbedded() && mayorChannelUrl() === null}
      onClick={() => {
        void discussWithMayor(ctx).then(openExternal, () => undefined);
      }}
    >
      Обсудить в Discord
    </button>
  );
}
