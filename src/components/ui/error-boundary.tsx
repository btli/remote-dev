"use client";

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Fallback component to render when an error occurs.
   * If not provided, a default error UI will be shown.
   */
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
  /**
   * Callback invoked when an error is caught.
   * Useful for logging errors to external services.
   */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /**
   * Optional name to identify the boundary in logs.
   */
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors in child components, logs errors,
 * and displays a fallback UI instead of crashing the entire tree.
 *
 * @example
 * ```tsx
 * <ErrorBoundary name="OrchestratorPanel">
 *   <OrchestratorStatusIndicator />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const boundaryName = this.props.name || "ErrorBoundary";
    console.error(
      `[${boundaryName}] Error caught:`,
      error,
      "\nComponent stack:",
      errorInfo.componentStack
    );

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return (
          <FallbackComponent
            error={this.state.error}
            resetError={this.resetError}
          />
        );
      }

      // Default fallback UI
      return (
        <Alert variant="destructive" className="my-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-2">
            <p className="text-sm">
              {this.state.error.message || "An unexpected error occurred"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={this.resetError}
              className="w-fit"
            >
              <RefreshCcw className="mr-2 h-3 w-3" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

/**
 * withErrorBoundary HOC
 *
 * Higher-order component that wraps a component with an error boundary.
 *
 * @example
 * ```tsx
 * const SafeComponent = withErrorBoundary(MyComponent, {
 *   name: "MyComponent",
 * });
 * ```
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName || Component.name || "Component"
  })`;

  return WrappedComponent;
}
