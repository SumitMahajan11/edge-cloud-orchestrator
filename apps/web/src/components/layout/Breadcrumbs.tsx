import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '../../lib/utils'

const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/nodes': 'Edge Nodes',
  '/scheduler': 'Task Scheduler',
  '/monitoring': 'Monitoring',
  '/logs': 'Logs',
  '/policies': 'Policies',
}

export function Breadcrumbs() {
  const location = useLocation()
  const currentLabel = routeLabels[location.pathname] || 'Unknown'
  
  return (
    <nav className="flex items-center gap-2 px-6 py-3 text-sm text-muted-foreground border-b border-border/50 bg-card/50">
      <Link 
        to="/" 
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Home</span>
      </Link>
      
      <ChevronRight className="h-3.5 w-3.5" />
      
      <span className={cn(
        'font-medium',
        location.pathname === '/' ? 'text-foreground' : 'text-muted-foreground'
      )}>
        {currentLabel}
      </span>
    </nav>
  )
}
