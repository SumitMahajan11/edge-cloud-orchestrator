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
  Sparkles,
  Bell,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTenant } from '../../contexts/TenantContext'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip"

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/nodes', label: 'Edge Nodes', icon: Server },
  { path: '/scheduler', label: 'Task Scheduler', icon: Calendar },
  { path: '/monitoring', label: 'Monitoring', icon: Activity },
  { path: '/ml-intelligence', label: 'ML Intelligence', icon: Sparkles },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/logs', label: 'Logs', icon: ScrollText },
  { path: '/policies', label: 'Policies', icon: Settings },
  { path: '/webhooks', label: 'Webhooks', icon: Webhook },
]

const adminNavItems = [
  { path: '/tenants', label: 'Tenants', icon: Users },
]

interface AppSidebarProps {
  isOpen: boolean
  onToggle: () => void
}

export function AppSidebar({ isOpen, onToggle }: AppSidebarProps) {
  const location = useLocation()
  const tenant = useTenant()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  
  const NavItem = ({ item, collapsed }: { item: typeof navItems[0], collapsed: boolean }) => {
    const Icon = item.icon
    const isActive = location.pathname === item.path
    
    const content = (
      <NavLink
        to={item.path}
        onClick={() => setIsMobileOpen(false)}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          collapsed && 'lg:justify-center lg:px-2'
        )}
      >
        <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-primary')} />
        {!collapsed && <span>{item.label}</span>}
      </NavLink>
    )

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            {content}
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-card border-border text-foreground">
            {item.label}
          </TooltipContent>
        </Tooltip>
      )
    }

    return content
  }

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
                <span className="font-semibold text-foreground tracking-tight">EdgeCloud</span>
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
              {navItems.map((item) => (
                <li key={item.path}>
                  <NavItem item={item} collapsed={!isOpen} />
                </li>
              ))}
            </ul>

            {tenant.isSuperAdmin && (
              <div className="mt-6">
                <div className={cn('px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground', !isOpen && 'text-center px-0')}>
                  {isOpen ? 'Administration' : 'Admin'}
                </div>
                <ul className="space-y-1">
                  {adminNavItems.map((item) => (
                    <li key={item.path}>
                      <NavItem item={item} collapsed={!isOpen} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>
          
          {/* Footer */}
          <div className="border-t border-border p-4">
            <div className={cn('flex items-center gap-3', !isOpen && 'lg:justify-center')}>
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center border border-border">
                <span className="text-[10px] font-bold text-primary">AD</span>
              </div>
              {isOpen && (
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-foreground truncate">Admin User</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Authenticated</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
