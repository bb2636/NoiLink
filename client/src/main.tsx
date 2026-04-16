import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initNativeBridge } from './native/initNativeBridge';
import './styles/index.css';

initNativeBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
