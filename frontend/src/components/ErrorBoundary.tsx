import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    // Keep fallback minimal and avoid leaking details to end users.
    console.error('UI render error captured by ErrorBoundary', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-brand-light">
          <div className="card max-w-md text-center">
            <h1 className="text-lg font-bold text-brand-dark mb-2">Se produjo un error inesperado</h1>
            <p className="text-sm text-gray-600">Recargá la página para continuar.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
