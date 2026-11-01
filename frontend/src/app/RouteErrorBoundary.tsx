import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { Button } from '@/components/ui';

/** Lazy chunks fail like this after a redeploy removed the hashed file the old page referenced. */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'ChunkLoadError' || CHUNK_ERROR.test(error.message));
}

function ErrorFallback({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('common');
  const outdated = isChunkLoadError(error);

  return (
    <div role="alert" className="mx-auto flex min-h-[60vh] max-w-measure flex-col items-start justify-center gap-5 px-5 py-16">
      <p className="text-micro font-medium tracking-eyebrow text-gold-600">
        {outdated ? t('errors.boundary.updatedEyebrow') : t('errors.boundary.eyebrow')}
      </p>
      <h1 className="font-display text-display-sm text-ink">
        {outdated ? t('errors.boundary.updatedTitle') : t('errors.boundary.title')}
      </h1>
      <p className="text-body text-muted">{outdated ? t('errors.boundary.updatedBody') : t('errors.boundary.body')}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {outdated ? (
          <Button onClick={() => window.location.reload()}>{t('actions.reload')}</Button>
        ) : (
          <Button onClick={onRetry}>{t('actions.tryAgain')}</Button>
        )}
        <Link to="/" className="text-small font-medium text-forest-600 underline-offset-4 hover:underline">
          {t('actions.backToHome')}
        </Link>
      </div>
    </div>
  );
}

interface BoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
  resetKey: string;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    // Navigating away from a broken page clears the error.
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Route render failed', error, info.componentStack);
  }

  private readonly retry = () => this.setState({ error: null });

  render() {
    if (this.state.error !== null) return <ErrorFallback error={this.state.error} onRetry={this.retry} />;
    return this.props.children;
  }
}

/** Catches render errors (including failed lazy chunks) and resets when the route changes. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
