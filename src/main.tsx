import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/syne/latin-700.css';
import '@fontsource/syne/latin-800.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/instrument-sans/latin-700.css';
import '@fontsource/instrument-sans/latin-400-italic.css';
import './styles/global.css';
import { App } from './app/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
