self.addEventListener('install', e => {
  console.log('Service Worker installed');
});

self.addEventListener('push', event => {
  const data = event.data?.text() || "Default notification message";
  event.waitUntil(
    self.registration.showNotification("Push Notification", {
      body: data,
      icon: 'icon-192.png'
    })
  );
});
