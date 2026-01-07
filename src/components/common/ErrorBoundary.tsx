"use client";

import React from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback component to show instead of default error UI */
  fallback?: React.ReactNode;
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Title to display in the error UI */
  title?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component to catch and handle React errors gracefully.
 * 
 * Prevents cascading failures by isolating errors to specific component trees.
 * 
 * @example
 * ```tsx
 * <ErrorBoundary title="Terminal Error">
 *   <Terminal sessionId={id} />
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
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-6 text-center min-h-[200px] bg-destructive/5 rounded-lg border border-destructive/20">
          <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {this.props.title || "Something went wrong"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            className="gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Minimal error boundary for inline components.
 * Shows a compact error state without breaking layout.
 */
export class InlineErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackText?: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallbackText?: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("InlineErrorBoundary caught an error:", error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <span className="text-destructive text-sm">
          {this.props.fallbackText || "Error loading component"}
        </span>
      );
    }

    return this.props.children;
  }
}
