interface ImportMetaEnv {
  readonly VITE_GC_SUPERVISOR_URL?: string;
  /**
   * Fallback Mayor's Discord channel (lib/mayorLink.ts) for a city whose
   * peer-boards service does not send `mayor_url` yet.
   */
  readonly VITE_MAYOR_DISCORD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
