import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      const activateUpdate = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      };

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            activateUpdate();
          }
        });
      });

      registration.update();
      checkForAppUpdate(registration);
    });
  });
}

async function checkForAppUpdate(registration) {
  if (!navigator.onLine) return;

  try {
    const response = await fetch(`/version.json?ts=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return;

    const { version } = await response.json();
    const currentVersion = window.localStorage.getItem('solitaire-app-version');

    if (currentVersion && currentVersion !== version) {
      await registration.update();
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
      return;
    }

    window.localStorage.setItem('solitaire-app-version', version);
  } catch {
    // Offline reloads keep using the latest cached shell.
  }
}
