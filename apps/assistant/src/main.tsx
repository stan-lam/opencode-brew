import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ModelSettingsProvider } from './contexts/ModelSettingsContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ModelSettingsProvider>
      <App />
    </ModelSettingsProvider>
  </React.StrictMode>
);
