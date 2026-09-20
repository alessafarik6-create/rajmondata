/* PWA + Web Push — Rajmondata */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "RAJMONDATA",
    body: "",
    url: "/portal/notifications",
    tag: "portal-notification",
    priority: "NORMAL",
  };
  try {
    if (event.data) {
      const t = event.data.text();
      if (t) payload = { ...payload, ...JSON.parse(t) };
    }
  } catch {
    /* ignore */
  }
  const title = payload.title || "RAJMONDATA";
  const isUrgent = payload.priority === "URGENT" || payload.priority === "HIGH";
  const options = {
    body: payload.body || "",
    icon: "/pwa-192.png",
    badge: "/pwa-192.png",
    tag: payload.tag || "portal-notification",
    renotify: true,
    data: { url: payload.url || "/portal/notifications" },
    vibrate: isUrgent ? [120, 60, 120] : undefined,
    actions: [
      { action: "open", title: "Otevřít" },
      { action: "dismiss", title: "Zavřít" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  if (event.action === "dismiss") {
    event.notification.close();
    return;
  }
  event.notification.close();
  const url = event.notification.data?.url || "/portal/notifications";
  const absolute = url.startsWith("http") ? url : new URL(url, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (!c.url) continue;
        try {
          const clientUrl = new URL(c.url);
          if (clientUrl.origin === self.location.origin && "focus" in c) {
            await c.focus();
            if ("navigate" in c && typeof c.navigate === "function") {
              try {
                await c.navigate(absolute);
              } catch {
                /* ignore */
              }
            }
            return;
          }
        } catch {
          /* ignore */
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(absolute);
      }
    })()
  );
});
