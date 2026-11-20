import { getActiveCity } from '../api/cityBase';
import { openExternal } from '../lib/openExternal';
import { tailscaleCardUrl } from './mode';

// Discord mode, v1 is read-only (DESIGN-discord-activity-return §4.3): the
// card's chat, attachments, live run and comments are not served through the
// Activity gateway. The drawer shows this one line instead, with a button to
// the same card on the owner's Tailscale board (through the SDK's
// openExternalLink, set as the openExternal seam).

export const TAILSCALE_NOTE = 'чат, вложения и живой прогон — на доске в Tailscale';

export function TailscaleNote({ beadId }: { beadId: string }) {
  const url = tailscaleCardUrl(getActiveCity(), beadId);
  return (
    <div
      data-testid="embed-tailscale-note"
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <span className="text-sm text-vk-text-low">{TAILSCALE_NOTE}</span>
      {url !== null && (
        <button
          type="button"
          onClick={() => openExternal(url)}
          className="min-h-[44px] rounded-sm border border-vk-border px-3 text-sm text-vk-text-high hover:bg-vk-bg-secondary focus-mark"
        >
          Открыть на доске
        </button>
      )}
    </div>
  );
}
