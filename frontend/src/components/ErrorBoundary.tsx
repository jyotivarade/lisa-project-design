import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-sm font-semibold text-red-900">Something went wrong</h2>
          <p className="mt-2 text-sm text-red-800">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-4 rounded bg-red-700 px-3 py-1.5 text-sm text-white"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
