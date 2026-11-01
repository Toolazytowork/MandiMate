import { Outlet } from 'react-router';
import { Footer } from './Footer';
import { Navbar } from './Navbar';
import { SkipLink } from './SkipLink';

/** Public site frame: sticky navbar, routed page in `<main id="main">`, editorial footer. */
export function MarketingLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <SkipLink />
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
