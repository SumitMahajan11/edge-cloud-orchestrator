import React, { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react'
import { logger } from '../../lib/logger'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  errorId: string | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorId: `err-${Date.now()}`,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error
    logger.error('React Error Boundary caught an error', error, {
      componentStack: errorInfo.componentStack,
    })

    // Update state with error info
    this.setState({ errorInfo })

    // Call custom error handler
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    })
  }

  handleGoHome = (): void => {
    window.location.href = '/'
  }

  handleReportBug = (): void => {
    const { error, errorInfo, errorId } = this.state
    const bugReport = {
      errorId,
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    }

    // Copy to clipboard
    navigator.clipboard.writeText(JSON.stringify(bugReport, null, 2))
    
    // In production, this would send to a bug tracking service
    logger.info('Bug report generated', { errorId })
    alert('Bug report copied to clipboard!')
  }

  render(): ReactNode {
    const { hasError, error, errorId } = this.state
    const { children, fallback } = this.props

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-lg w-full">
            <div className="bg-card border border-border rounded-lg shadow-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-destructive/10 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Something went wrong</h2>
                  <p className="text-sm text-muted-foreground">
                    Error ID: {errorId}
                  </p>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 mb-4">
                <p className="text-sm font-mono text-destructive break-all">
                  {error?.message || 'An unexpected error occurred'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={this.handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>

                <button
                  onClick={this.handleGoHome}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
                >
                  <Home className="w-4 h-4" />
                  Go Home
                </button>

                <button
                  onClick={this.handleReportBug}
                  className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 transition-colors"
                >
                  <Bug className="w-4 h-4" />
                  Report Bug
                </button>
              </div>

              {import.meta.env.DEV && error?.stack && (
                <details className="mt-4">
                  <summary className="text-sm text-muted-foreground cursor-pointer">
                    View Stack Trace
                  </summary>
                  <pre className="mt-2 p-4 bg-muted/50 rounded-lg overflow-auto text-xs font-mono">
                    {error.stack}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )
    }

    return children
  }
}

// Higher-order component for wrapping components with error boundary
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    )
  }
}

// Async error boundary for handling async errors
export function useAsyncError(): (error: Error) => void {
  const [, setError] = React.useState<Error | null>(null)

  return (error: Error) => {
    setError(() => {
      throw error
    })
  }
}

export { ErrorBoundary }
