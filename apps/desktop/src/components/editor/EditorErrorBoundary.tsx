/**
 * EditorErrorBoundary - Catches errors in the editor and displays fallback UI
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Editor error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-[#1e1e1e] p-8">
          <div className="text-center space-y-4 max-w-md">
            <AlertCircle className="w-12 h-12 text-[#f44747] mx-auto" />
            <h2 className="text-lg font-medium text-white">Editor Error</h2>
            <p className="text-sm text-[#8b8b8b]">
              Something went wrong while rendering the editor.
            </p>
            {this.state.error && (
              <pre className="text-xs text-[#6e7681] bg-[#252526] p-3 rounded overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#007acc] text-white rounded hover:bg-[#1c8ad4] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
