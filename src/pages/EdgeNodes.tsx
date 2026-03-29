import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../components/ui/button'
import { StatusBadge } from '../components/shared/StatusBadge'
import { NodeDetailModal } from '../components/modals/NodeDetailModal'
import { AddNodeModal } from '../components/modals/AddNodeModal'
import { 
  Plus, 
  Trash2, 
  Server, 
  MapPin, 
  Activity,
  HardDrive,
  Wifi,
  Clock,
  Eye
} from 'lucide-react'
import type { EdgeNode } from '../types'
// import { formatDuration } from '../lib/utils'

interface EdgeNodesProps {
  nodes: EdgeNode[]
  onAddNode: (nodeData?: Partial<EdgeNode>) => void
  onRemoveNode: (nodeId: string) => void
}

export function EdgeNodes({ nodes, onAddNode, onRemoveNode }: EdgeNodesProps) {
  // const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<EdgeNode | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  
  // Toggle selection functionality commented out
  // const toggleSelection = (nodeId: string) => {
  //   const newSelected = new Set(selectedNodes)
  //   if (newSelected.has(nodeId)) {
  //     newSelected.delete(nodeId)
  //   } else {
  //     newSelected.add(nodeId)
  //   }
  //   setSelectedNodes(newSelected)
  // }
  
  const handleNodeClick = (node: EdgeNode) => {
    setSelectedNode(node)
    setIsDetailModalOpen(true)
  }

  const handleAddNode = (nodeData: Partial<EdgeNode>) => {
    onAddNode(nodeData)
    setIsAddModalOpen(false)
  }
  
  return (
    <>
      <NodeDetailModal 
        node={selectedNode} 
        isOpen={isDetailModalOpen} 
        onClose={() => setIsDetailModalOpen(false)} 
      />
      <AddNodeModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddNode}
      />
      <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Edge Nodes</h2>
          <p className="text-muted-foreground">Manage your distributed edge infrastructure</p>
        </div>
        <Button onClick={onAddNode} className="gap-2">
          <Plus className="h-4 w-4" />
          Register Node
        </Button>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Nodes</p>
          <p className="text-2xl font-bold font-mono text-foreground">{nodes.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Online</p>
          <p className="text-2xl font-bold font-mono text-success">
            {nodes.filter(n => n.status === 'online').length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Degraded</p>
          <p className="text-2xl font-bold font-mono text-warning">
            {nodes.filter(n => n.status === 'degraded').length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Offline</p>
          <p className="text-2xl font-bold font-mono text-destructive">
            {nodes.filter(n => n.status === 'offline').length}
          </p>
        </div>
      </div>
      
      {/* Node Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {nodes.map((node) => (
            <motion.div
              key={node.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <button 
                  onClick={() => handleNodeClick(node)}
                  className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                    <Server className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{node.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {node.location}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <StatusBadge status={node.status} />
                  <button
                    onClick={() => handleNodeClick(node)}
                    className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                    title="View details"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onRemoveNode(node.id)}
                    disabled={node.tasksRunning > 0}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={node.tasksRunning > 0 ? 'Cannot remove node with running tasks' : 'Remove node'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {/* Metrics */}
              <div className="space-y-3">
                {/* CPU */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      CPU
                    </span>
                    <span className="font-mono text-foreground">{node.cpu.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        node.cpu > 80 ? 'bg-destructive' : node.cpu > 60 ? 'bg-warning' : 'bg-primary'
                      }`}
                      style={{ width: `${Math.min(node.cpu, 100)}%` }}
                    />
                  </div>
                </div>
                
                {/* Memory */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      Memory
                    </span>
                    <span className="font-mono text-foreground">{node.memory.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        node.memory > 80 ? 'bg-destructive' : node.memory > 60 ? 'bg-warning' : 'bg-info'
                      }`}
                      style={{ width: `${Math.min(node.memory, 100)}%` }}
                    />
                  </div>
                </div>
                
                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Wifi className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Latency:</span>
                    <span className="font-mono text-foreground">{Math.round(node.latency)}ms</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Uptime:</span>
                    <span className="font-mono text-foreground">{node.uptime.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Server className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Tasks:</span>
                    <span className="font-mono text-foreground">{node.tasksRunning}/{node.maxTasks}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Activity className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">IP:</span>
                    <span className="font-mono text-foreground">{node.ip}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      
      {nodes.length === 0 && (
        <div className="text-center py-16">
          <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No nodes registered</h3>
          <p className="text-muted-foreground mb-4">Add your first edge node to get started</p>
          <Button onClick={onAddNode}>
            <Plus className="h-4 w-4 mr-2" />
            Register Node
          </Button>
        </div>
      )}
      </div>
    </>
  )
}
