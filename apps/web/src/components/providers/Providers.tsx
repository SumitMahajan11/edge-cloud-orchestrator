'use client'

import { useState, useEffect, useCallback } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from '@/lib/query-client'
import { AuthProvider } from '@/context/AuthContext'
import { TenantProvider } from '@/contexts/TenantContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { initWsStore } from '@/stores/websocket'
import { initTracing } from '@/telemetry/tracing'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toaster } from '@/components/ui/sonner'
import { Layout } from '@/components/layout/Layout'
import { CommandPalette } from '@/components/modals/CommandPalette'

export function Providers({ children }: { children: React.ReactNode }) {
  const { state: persistedState, isLoaded: persistedLoaded } = usePersistentState()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  
  // Theme toggle
  const toggleTheme = useCallback(() => {
    const newValue = persistedState.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('light', newValue === 'light')
    document.documentElement.classList.toggle('dark', newValue === 'dark')
  }, [persistedState.theme])
  
  // Initialize theme from persisted state
  useEffect(() => {
    if (!persistedLoaded) return
    const isDark = persistedState.theme === 'dark'
    document.documentElement.classList.toggle('light', !isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [persistedLoaded, persistedState.theme])

  // Initialize WebSocket and Tracing once
  useEffect(() => {
    initWsStore()
    initTracing()
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TenantProvider>
          <TooltipProvider delayDuration={200}>
            <CommandPalette 
              isOpen={commandPaletteOpen} 
              onClose={() => setCommandPaletteOpen(false)} 
            />
            <Layout
              isDark={persistedState.theme === 'dark'}
              onToggleTheme={toggleTheme}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            >
              {children}
            </Layout>
            <Toaster 
              position="bottom-right"
              toastOptions={{
                className: 'bg-card border-border text-foreground',
              }}
            />
            <ReactQueryDevtools initialIsOpen={false} />
          </TooltipProvider>
        </TenantProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
