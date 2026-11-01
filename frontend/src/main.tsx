import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from '@/app/App';
import { createQueryClient } from '@/lib/query';

const container = document.getElementById('root');
if (!container) throw new Error('MandiMate: #root element is missing from index.html');

/** Prerendered pages ship markup inside #root; the SPA fallback (app.html) ships it empty. */
const hydrating = container.firstElementChild !== null;
const queryClient = createQueryClient();

const app = (
  <StrictMode>
    <BrowserRouter>
      <App queryClient={queryClient} hydrating={hydrating} />
    </BrowserRouter>
  </StrictMode>
);

if (hydrating) {
  hydrateRoot(container, app);
} else {
  createRoot(container).render(app);
}
