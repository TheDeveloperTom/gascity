interface ImportMetaEnv {
  readonly VITE_GC_SUPERVISOR_URL?: string;
  /** The Mayor's Discord channel (lib/discussWithMayor.ts); unset disables «Обсудить в Discord». */
  readonly VITE_MAYOR_DISCORD_URL?: string;
  /** Discord Activity client id (config/activity-gw.json client_id, set by build-spa); main.tsx / embed/activitySdk.ts. */
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
