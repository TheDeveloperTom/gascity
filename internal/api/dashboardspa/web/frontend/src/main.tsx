import React from 'react';
import ReactDOM from 'react-dom/client';
import { CityBootstrap } from './CityBootstrap';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocaleProvider } from './i18n/LocaleProvider';
import 'react-diff-view/style/index.css';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// gascity-dashboard-ucc: CityBootstrap resolves the active city from the
// `/city/:cityName` URL segment (or redirects a bare `/` to the first city)
// and mounts the router under that segment as its basename, so the rest of
// the app keeps using city-relative absolute links unchanged.
ReactDOM.createRoot(root).render(
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
