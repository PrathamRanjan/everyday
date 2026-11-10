// Everyday service worker: the app shell and its built assets work offline; data stays live; push notifications.
const CACHE = "ev-v2";
const SHELL = "/login";
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL).catch(() => null)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Built files are content-hashed, so a cached copy is always the right one.
  if (u.pathname.startsWith("/assets/") || u.pathname.startsWith("/fonts/")) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })));
    return;
  }
  // Pages: always the network; offline, the cached shell, which shows its own offline banner.
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => caches.match(SHELL)));
});
self.addEventListener("push", (e) => {
  let d = { title: "Everyday", body: "", url: "/today" };
  try { d = Object.assign(d, e.data.json()); } catch (_) { d.body = e.data ? e.data.text() : ""; }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, data: { url: d.url }, icon: "/favicon.svg", badge: "/favicon.svg" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window" }).then((cs) => { for (const c of cs) if ("focus" in c) { c.navigate(e.notification.data.url); return c.focus(); } return clients.openWindow(e.notification.data.url); }));
});
