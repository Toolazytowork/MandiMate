import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * Scrolls to the top on forward navigation, or to the `#hash` target when present. Back/forward
 * (POP) navigations keep the browser's own scroll restoration.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') return;
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash, navigationType]);

  return null;
}
