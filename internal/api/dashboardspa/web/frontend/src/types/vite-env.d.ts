interface ImportMetaEnv {
  readonly VITE_GC_SUPERVISOR_URL?: string;
  /** The Mayor's Discord channel (lib/discussWithMayor.ts); unset disables «Обсудить в Discord». */
  readonly VITE_MAYOR_DISCORD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
