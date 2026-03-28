import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../../lib/utils'
import {
  LayoutDashboard,
  Server,
  Calendar,
  Activity,
  ScrollText,
  Settings,
  Menu,
  X,
  Webhook,
} from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/nodes', label: 'Edge Nodes', icon: Server },
  { path: '/scheduler', label: 'Task Scheduler', icon: Calendar },
  { path: '/monitoring', label: 'Monitoring', icon: Activity },
  { path: '/logs', label: 'Logs', icon: ScrollText },
  { path: '/policies', label: 'Policies', icon: Settings },
  { path: '/webhooks', label: 'Webhooks', icon: Webhook },
]

interface AppSidebarProps {
  isOpen: boolean
  onToggle: () => void
}

export function AppSidebar({ isOpen, onToggle }: AppSidebarProps) {
  const location = useLocation()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  
  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
      
      {/* Mobile toggle button */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg bg-card border border-border hover:bg-secondary transition-colors"
      >
        {isMobileOpen ? (
          <X className="h-5 w-5 text-foreground" />
        ) : (
          <Menu className="h-5 w-5 text-foreground" />
        )}
      </button>
      
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen bg-card border-r border-border transition-all duration-300',
          isOpen ? 'w-64' : 'w-20',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            <div className={cn('flex items-center gap-3', !isOpen && 'lg:justify-center lg:w-full')}>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Server className="h-4 w-4 text-primary-foreground" />
              </div>
              {isOpen && (
                <span className="font-semibold text-foreground">EdgeCloud</span>
              )}
            </div>
            <button
              onClick={onToggle}
              className="hidden lg:flex p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <Menu className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4 px-3">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path
                
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={() => setIsMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        !isOpen && 'lg:justify-center lg:px-2'
                      )}
                    >
                      <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-primary')} />
                      {isOpen && <span>{item.label}</span>}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>
          
          {/* Footer */}
          <div className="border-t border-border p-4">
            <div className={cn('flex items-center gap-3', !isOpen && 'lg:justify-center')}>
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                <span className="text-xs font-medium text-foreground">EC</span>
              </div>
              {isOpen && (
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">Admin</span>
                  <span className="text-xs text-muted-foreground">admin@edgecloud.io</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
