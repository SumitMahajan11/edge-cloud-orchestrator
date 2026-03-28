import { useState } from 'react'
import { AppSidebar } from './AppSidebar'
import { Header } from './Header'
import { Breadcrumbs } from './Breadcrumbs'
import { Toaster } from '../ui/sonner'

interface LayoutProps {
  children: React.ReactNode
  isSimulating: boolean
  onToggleSimulation: () => void
  isDark: boolean
  onToggleTheme: () => void
  onOpenCommandPalette: () => void
}

export function Layout({
  children,
  isSimulating,
  onToggleSimulation,
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
}: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        isOpen={sidebarOpen} 
        onToggle={() => setSidebarOpen(!sidebarOpen)} 
      />
      
      <div 
        className="transition-all duration-300"
        style={{ marginLeft: sidebarOpen ? '16rem' : '5rem' }}
      >
        <Header
          isSimulating={isSimulating}
          onToggleSimulation={onToggleSimulation}
          isDark={isDark}
          onToggleTheme={onToggleTheme}
          onOpenCommandPalette={onOpenCommandPalette}
        />
        
        <Breadcrumbs />
        
        <main className="bg-grid min-h-[calc(100vh-8rem)]">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
      
      <Toaster 
        position="bottom-right"
        toastOptions={{
          className: 'bg-card border-border text-foreground',
        }}
      />
    </div>
  )
}
