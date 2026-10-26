import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BtcPriceProvider } from './context/BtcPriceContext';

const root = createRoot(document.getElementById('root'));
root.render(
  <BtcPriceProvider>
    <App />
  </BtcPriceProvider>
);
