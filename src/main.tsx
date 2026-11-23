import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { StoreProvider } from './data/store';
import { DocInboxProvider } from './docs/inbox';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <DocInboxProvider>
        <App />
      </DocInboxProvider>
    </StoreProvider>
  </StrictMode>
);
