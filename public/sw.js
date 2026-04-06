/* PWA + Web Push */
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
  let payload = { title: "Rajmondata", body: "", url: "/portal/notifications" };
  try {
    if (event.data) {
      const t = event.data.text();
      if (t) payload = { ...payload, ...JSON.parse(t) };
    }
  } catch {
    /* ignore */
  }
  const title = payload.title || "Rajmondata";
  const options = {
    body: payload.body || "",
    icon: "/pwa-192.png",
    badge: "/pwa-192.png",
    tag: payload.tag || "portal-notification",
    data: { url: payload.url || "/portal/notifications" },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/portal/notifications";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url && "focus" in c) {
          await c.focus();
          if ("navigate" in c && typeof c.navigate === "function") {
            try {
              c.navigate(url);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});
