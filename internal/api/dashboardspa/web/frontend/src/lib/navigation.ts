// Seam stub (vk lane 0b). Owner: lane 6. Other lanes import, never edit.

/** The only full reload. It keeps location.search (the Activity's frame_id/instance_id). */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
