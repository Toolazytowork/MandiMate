import { AppIndexRedirect } from '@/app/AppIndexRedirect';

/** `/app` has no screen of its own: it forwards to the signed-in user's role home. */
export default function AppIndexPage() {
  return <AppIndexRedirect />;
}
