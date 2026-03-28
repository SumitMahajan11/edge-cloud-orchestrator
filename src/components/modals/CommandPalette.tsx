import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  LayoutDashboard, 
  Server, 
  Calendar, 
  Activity, 
  ScrollText, 
  Settings,
  Search,
  Command
} from 'lucide-react'
import { cn } from '../../lib/utils'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

interface CommandItem {
  id: string
  label: string
  icon: React.ElementType
  shortcut?: string
  action: () => void
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  
  const commands: CommandItem[] = useMemo(() => [
    {
      id: 'dashboard',
      label: 'Go to Dashboard',
      icon: LayoutDashboard,
      shortcut: 'G D',
      action: () => { navigate('/'); onClose(); },
    },
    {
      id: 'nodes',
      label: 'Go to Edge Nodes',
      icon: Server,
      shortcut: 'G N',
      action: () => { navigate('/nodes'); onClose(); },
    },
    {
      id: 'scheduler',
      label: 'Go to Task Scheduler',
      icon: Calendar,
      shortcut: 'G T',
      action: () => { navigate('/scheduler'); onClose(); },
    },
    {
      id: 'monitoring',
      label: 'Go to Monitoring',
      icon: Activity,
      shortcut: 'G M',
      action: () => { navigate('/monitoring'); onClose(); },
    },
    {
      id: 'logs',
      label: 'Go to Logs',
      icon: ScrollText,
      shortcut: 'G L',
      action: () => { navigate('/logs'); onClose(); },
    },
    {
      id: 'policies',
      label: 'Go to Policies',
      icon: Settings,
      shortcut: 'G P',
      action: () => { navigate('/policies'); onClose(); },
    },
  ], [navigate, onClose])
  
  const filteredCommands = useMemo(() => {
    if (!searchQuery) return commands
    const query = searchQuery.toLowerCase()
    return commands.filter(cmd => 
      cmd.label.toLowerCase().includes(query)
    )
  }, [commands, searchQuery])
  
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => prev > 0 ? prev - 1 : prev)
          break
        case 'Enter':
          e.preventDefault()
          filteredCommands[selectedIndex]?.action()
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex, onClose])
  
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg z-50"
          >
            <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
              {/* Search Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <Search className="h-5 w-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search commands..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                  autoFocus
                />
                <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  <Command className="h-3 w-3" />
                  K
                </kbd>
              </div>
              
              {/* Commands List */}
              <div className="max-h-[300px] overflow-y-auto py-2">
                {filteredCommands.length > 0 ? (
                  filteredCommands.map((command, index) => {
                    const Icon = command.icon
                    const isSelected = index === selectedIndex
                    
                    return (
                      <button
                        key={command.id}
                        onClick={command.action}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'
                        )}
                      >
                        <Icon className={cn(
                          'h-4 w-4',
                          isSelected ? 'text-primary' : 'text-muted-foreground'
                        )} />
                        <span className={cn(
                          'flex-1 text-sm',
                          isSelected ? 'text-primary font-medium' : 'text-foreground'
                        )}>
                          {command.label}
                        </span>
                        {command.shortcut && (
                          <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                            {command.shortcut}
                          </kbd>
                        )}
                      </button>
                    )
                  })
                ) : (
                  <div className="px-4 py-8 text-center text-muted-foreground">
                    No commands found
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-secondary/30 text-xs text-muted-foreground">
                <div className="flex gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-secondary px-1.5 py-0.5">↑↓</kbd>
                    Navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-secondary px-1.5 py-0.5">↵</kbd>
                    Select
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-secondary px-1.5 py-0.5">Esc</kbd>
                  Close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
