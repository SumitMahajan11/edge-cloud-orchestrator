import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import { Play, Pause, Sun, Moon, Command, Bell, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

interface HeaderProps {
  isSimulating: boolean
  onToggleSimulation: () => void
  isDark: boolean
  onToggleTheme: () => void
  onOpenCommandPalette: () => void
}

export function Header({
  isSimulating,
  onToggleSimulation,
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
}: HeaderProps) {
  const { user, logout } = useAuth()
  
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/80 backdrop-blur-md px-6">
      <div className="flex items-center gap-4">
        {/* System Status */}
        <Badge 
          variant="outline" 
          className={cn(
            'gap-2 px-3 py-1.5 font-mono text-xs',
            isSimulating && 'border-success/50 bg-success/10'
          )}
        >
          <span className={cn(
            'h-2 w-2 rounded-full',
            isSimulating ? 'bg-success animate-pulse' : 'bg-muted-foreground'
          )} />
          <span className={isSimulating ? 'text-success' : 'text-muted-foreground'}>
            {isSimulating ? 'System Active' : 'System Paused'}
          </span>
        </Badge>
      </div>
      
      <div className="flex items-center gap-2">
        {/* Command Palette Button */}
        <Button
          variant="outline"
          size="sm"
          className="hidden md:flex gap-2 text-muted-foreground"
          onClick={onOpenCommandPalette}
        >
          <Command className="h-4 w-4" />
          <span className="text-xs">Cmd+K</span>
        </Button>
        
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          className="h-9 w-9"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
        
        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 relative"
        >
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
        </Button>
        
        {/* Play/Pause Toggle */}
        <Button
          variant={isSimulating ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleSimulation}
          className={cn(
            'gap-2 min-w-[100px]',
            isSimulating && 'glow-primary'
          )}
        >
          {isSimulating ? (
            <>
              <Pause className="h-4 w-4" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              <span>Resume</span>
            </>
          )}
        </Button>
        
        {/* Logout Button */}
        {user && (
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="gap-2 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        )}
      </div>
    </header>
  )
}
