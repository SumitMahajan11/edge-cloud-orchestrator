import { Button } from '../ui/button'

import { Sun, Moon, Command, Bell, LogOut, User, Settings, Shield, Info, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { ConnectionStatusPill } from './ConnectionStatusPill'
import { cn } from "../../lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { LiveIndicator } from "../shared/LiveIndicator"

interface HeaderProps {
  isDark: boolean
  onToggleTheme: () => void
  onOpenCommandPalette: () => void
}

const MOCK_NOTIFICATIONS = [
  { id: 1, title: 'Node NYC-01 offline', type: 'error', time: '2m ago', icon: AlertTriangle },
  { id: 2, title: 'Task batch completed', type: 'info', time: '15m ago', icon: Info },
  { id: 3, title: 'New policy deployed', type: 'success', time: '1h ago', icon: Shield },
]

export function Header({
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
}: HeaderProps) {
  const { user, logout } = useAuth()
  
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/80 backdrop-blur-md px-6">
      <div className="flex items-center gap-4">
        <LiveIndicator active={true} label="SYSTEM ACTIVE" />
        <ConnectionStatusPill />
      </div>
      
      <div className="flex items-center gap-2">
        {/* Command Palette Button */}
        <Button
          variant="outline"
          size="sm"
          className="hidden md:flex gap-2 text-muted-foreground bg-secondary/30 border-border/50 hover:bg-secondary/50"
          onClick={onOpenCommandPalette}
        >
          <Command className="h-3 w-3" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Cmd+K</span>
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
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 relative"
            >
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary border-2 border-card" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="p-4 border-b border-border bg-secondary/20">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold uppercase tracking-wider">Notifications</h4>
                <Button variant="ghost" size="sm" className="h-auto p-0 text-[10px] font-bold text-primary">Mark all as read</Button>
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto py-2">
              {MOCK_NOTIFICATIONS.map((n) => (
                <div key={n.id} className="flex gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer group">
                  <div className="mt-1 h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <n.icon className={cn("h-4 w-4", n.type === 'error' ? 'text-destructive' : 'text-primary')} />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm text-foreground font-medium group-hover:text-primary transition-colors">{n.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{n.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-border">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground">View all notifications</Button>
            </div>
          </PopoverContent>
        </Popover>
        
        <div className="h-6 w-[1px] bg-border mx-2" />
        
        {/* User Menu */}
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarImage src={`https://avatar.vercel.sh/${user.id}.png`} alt={user.email} />
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                    {user.email.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.email}</p>
                  <p className="text-xs leading-none text-muted-foreground uppercase tracking-widest font-bold mt-1">
                    Administrator
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className="gap-2">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                  <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                  <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="gap-2 text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
                <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="h-9 w-9 rounded-full bg-secondary animate-pulse" />
        )}
      </div>
    </header>
  )
}
