/**
 * PWA instalace: `PwaInstallProvider` v `FirebaseClientProvider`;
 * banner (`PwaInstallBanner`) je v `portal/layout` a `admin/layout` po přihlášení.
 */
export {
  PwaInstallProvider,
  PwaInstallProvider as InstallAppPrompt,
  usePwaInstall,
} from "./pwa-install-context";
export { PwaInstallBanner, InstallAppBanner } from "./pwa-install-banner";
export { PwaInstallBanner as InstallAppButton } from "./pwa-install-banner";
export { PwaInstallBanner as PwaInstallPrompt } from "./pwa-install-banner";
