import React from 'react';
import ReactDOM from 'react-dom/client';
import { CityBootstrap } from './CityBootstrap';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocaleProvider } from './i18n/LocaleProvider';
import 'react-diff-view/style/index.css';
// IBM Plex for the vibe-kanban port (--vk-font-sans / --vk-font-mono), bundled
// from @fontsource: self-hosted, fetched only when a face is used.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/index.css';

import { registerServiceWorker } from './lib/pwa';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

function mount(el: HTMLElement): void {
  // gascity-dashboard-ucc: CityBootstrap resolves the active city from the
  // `/city/:cityName` URL segment (or redirects a bare `/` to the first city)
  // and mounts the router under that segment as its basename, so the rest of
  // the app keeps using city-relative absolute links unchanged.
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <LocaleProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <CityBootstrap />
          </ErrorBoundary>
        </ThemeProvider>
      </LocaleProvider>
    </React.StrictMode>,
  );
}

mount(root);

// Owner 16.11: an installable web app (PWA). The service worker caches the
// app shell only and is registered in production builds only.
void registerServiceWorker({
  prod: (import.meta.env as unknown as Record<string, unknown>).PROD === true,
  nav: globalThis.navigator,
});
