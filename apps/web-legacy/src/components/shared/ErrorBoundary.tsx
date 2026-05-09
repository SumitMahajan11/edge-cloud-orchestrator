import React, { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, Bug, ShieldAlert, Terminal } from 'lucide-react'
import { logger } from '../../lib/logger'
import { Button } from '../ui/button'

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
      errorId: `ERR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('Critical Mission Control Failure', error, {
      componentStack: errorInfo.componentStack,
    })
    this.setState({ errorInfo })
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

    navigator.clipboard.writeText(JSON.stringify(bugReport, null, 2))
    alert('Telemetry dump copied to clipboard. Please include this in your report.')
  }

  render(): ReactNode {
    const { hasError, error, errorId, errorInfo } = this.state
    const { children, fallback } = this.props

    if (hasError) {
      if (fallback) return fallback

      return (
        <div className="min-h-screen bg-[#050508] text-foreground flex items-center justify-center p-6 font-mono relative overflow-hidden">
          {/* Background Grid Pattern */}
          <div className="absolute inset-0 opacity-10 pointer-events-none bg-grid" />
          
          {/* Scanline Effect */}
          <div className="absolute inset-0 pointer-events-none bg-scanlines opacity-[0.03]" />

          <div className="max-w-2xl w-full relative">
            <div className="bg-[#0a0a0f] border border-destructive/50 rounded-lg shadow-2xl overflow-hidden">
              {/* Header Bar */}
              <div className="bg-destructive/10 border-b border-destructive/30 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">System Panic</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  FAULT_ID: {errorId}
                </div>
              </div>

              <div className="p-8">
                <div className="flex items-start gap-6 mb-8">
                  <div className="h-16 w-16 shrink-0 rounded-xl bg-destructive/10 flex items-center justify-center border border-destructive/20 glow-red">
                    <AlertTriangle className="h-8 w-8 text-destructive animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold tracking-tight">Mission Control Failure</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      A critical error has occurred in the orchestrator interface. 
                      Subsystem telemetry has been interrupted.
                    </p>
                  </div>
                </div>

                <div className="bg-[#050508] border border-border/50 rounded-md p-4 mb-8 relative group">
                  <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                    <Terminal className="h-3 w-3" />
                    Error Trace
                  </div>
                  <div className="text-sm text-destructive font-bold mb-1">
                    {error?.name}: {error?.message}
                  </div>
                  <pre className="text-[10px] text-muted-foreground/80 overflow-x-auto whitespace-pre-wrap max-h-40 scrollbar-thin">
                    {errorInfo?.componentStack || error?.stack || 'No trace available.'}
                  </pre>
                  
                  {/* Subtle corner decor */}
                  <div className="absolute top-0 right-0 p-1">
                    <div className="w-2 h-2 border-t border-r border-destructive/30" />
                  </div>
                  <div className="absolute bottom-0 left-0 p-1">
                    <div className="w-2 h-2 border-b border-l border-destructive/30" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4">
                  <Button
                    onClick={this.handleRetry}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 h-11"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Restart Subsystem
                  </Button>

                  <Button
                    variant="outline"
                    onClick={this.handleGoHome}
                    className="border-border hover:bg-secondary/50 flex-1 h-11"
                  >
                    <Home className="w-4 h-4 mr-2" />
                    Return Home
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={this.handleReportBug}
                    className="text-muted-foreground hover:text-foreground h-11"
                  >
                    <Bug className="w-4 h-4 mr-2" />
                    Copy Telemetry
                  </Button>
                </div>
              </div>

              {/* Status Bar */}
              <div className="bg-secondary/30 px-4 py-2 border-t border-border flex justify-between items-center text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
                <span>Orchestrator v4.0.0</span>
                <span className="text-destructive">Critical State</span>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return children
  }
}

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

export function useAsyncError(): (error: Error) => void {
  const [, setError] = React.useState<Error | null>(null)

  return (error: Error) => {
    setError(() => {
      throw error
    })
  }
}

export { ErrorBoundary }
