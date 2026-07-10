import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional short label for what crashed, shown in the fallback message. */
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render/runtime errors in its subtree and shows a friendly fallback
 * instead of an unrecoverable blank/white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold">
            {this.props.fallbackLabel ? `${this.props.fallbackLabel} gagal dimuat` : "Terjadi kesalahan"}
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Halaman mengalami error saat ditampilkan. Coba muat ulang halaman ini.
          </p>
          <Button size="sm" className="gap-2" onClick={() => { this.handleReset(); window.location.reload(); }}>
            <RefreshCw className="h-4 w-4" />Muat Ulang
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
