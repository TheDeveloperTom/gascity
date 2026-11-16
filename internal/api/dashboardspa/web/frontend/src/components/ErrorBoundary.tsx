import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorMessage } from 'gas-city-dashboard-shared';
import { reportClientError } from '../lib/clientErrorReporting';
import { t } from '../i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  crashed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown, _errorInfo: ErrorInfo): void {
    void reportClientError({
      component: 'ErrorBoundary',
      operation: 'componentDidCatch',
      message: errorMessage(error),
    });
  }

  override render() {
    if (this.state.crashed) {
      return (
        <main className="mx-auto max-w-dashboard px-4 py-8 sm:px-6">
          <section
            className="mx-auto max-w-[40rem] space-y-2 rounded-lg border border-rule bg-surface-raised p-6"
            role="alert"
          >
            <h1 className="text-headline font-semibold text-fg">{t('Dashboard view failed.')}</h1>
            <p className="text-body text-fg-muted">
              {t('The error was reported to the local dashboard log. Refresh to retry this view.')}
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
