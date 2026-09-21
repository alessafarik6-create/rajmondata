import type { HikvisionProvider } from "@/lib/hikvision/providers/types";
import { loadHikvisionIntegration } from "@/lib/hikvision/stores";

export const localConnectorProvider: HikvisionProvider = {
  id: "LOCAL_CONNECTOR",

  async testConnection(ctx) {
    const integration = await loadHikvisionIntegration(ctx.db, ctx.organizationId);
    const online = Boolean(integration?.connectorOnline);
    if (!online) {
      return {
        ok: false,
        provider: "LOCAL_CONNECTOR",
        code: "DEVICE_OFFLINE",
        error: "Local Connector neodesílá heartbeat.",
      };
    }
    return {
      ok: true,
      provider: "LOCAL_CONNECTOR",
      message: "Local Connector online.",
    };
  },

  async syncDevices() {
    return {
      ok: false,
      code: "HIKCONNECT_API_NOT_CONFIGURED",
      error: "Sync zařízení přes Local Connector: TODO (job queue z cloudu na connector).",
    };
  },

  async syncCameras() {
    return {
      ok: false,
      code: "HIKCONNECT_API_NOT_CONFIGURED",
      error: "Sync kamer přes Local Connector: TODO.",
    };
  },

  async getSnapshot() {
    return {
      ok: false,
      code: "HIKCONNECT_API_NOT_CONFIGURED",
      error: "Snapshot přes Local Connector: TODO.",
    };
  },

  async getLiveView() {
    return {
      ok: false,
      code: "LIVE_VIEW_NOT_SUPPORTED",
      error: "Live view přes Local Connector: TODO.",
    };
  },
};
