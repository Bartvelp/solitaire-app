import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

const app = createApp(App);
const vm = app.mount('#app');
window.__solitaireApp = vm;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
