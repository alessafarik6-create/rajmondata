/**
 * Logické oprávnění kamery — mapování na portálový modul `cameras`:
 * - CAMERAS_VIEW, CAMERAS_LIVE, CAMERAS_PLAYBACK → read
 * - CAMERAS_ADMIN → write (nastavení, sync, connector)
 */
export const HIKVISION_PERMISSION = {
  VIEW: "CAMERAS_VIEW",
  LIVE: "CAMERAS_LIVE",
  PLAYBACK: "CAMERAS_PLAYBACK",
  ADMIN: "CAMERAS_ADMIN",
} as const;
