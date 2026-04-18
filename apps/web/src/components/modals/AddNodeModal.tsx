import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Server, MapPin, Cpu, HardDrive, Wifi, Globe } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import type { EdgeNode } from '../../types'

interface AddNodeModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (nodeData: Partial<EdgeNode>) => void
}

const REGIONS = [
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'sa-east-1',
]

const NODE_TYPES = [
  { value: 'edge', label: 'Edge Node', description: 'Low-latency edge computing' },
  { value: 'cloud', label: 'Cloud Node', description: 'High-capacity cloud computing' },
  { value: 'hybrid', label: 'Hybrid Node', description: 'Combined edge and cloud' },
]

export function AddNodeModal({ isOpen, onClose, onSubmit }: AddNodeModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    region: 'us-east-1',
    nodeType: 'edge',
    ip: '',
    cpu: 4,
    memory: 8192,
    storage: 100,
    costPerHour: 0.05,
    maxTasks: 10,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.name.trim()) {
      newErrors.name = 'Node name is required'
    }
    if (!formData.location.trim()) {
      newErrors.location = 'Location is required'
    }
    if (!formData.ip.trim()) {
      newErrors.ip = 'IP address is required'
    } else {
      const parts = formData.ip.trim().split('.')
      const valid = parts.length === 4 && parts.every(p => {
        const n = parseInt(p, 10)
        return /^\d+$/.test(p) && n >= 0 && n <= 255
      })
      if (!valid) newErrors.ip = 'Invalid IP address format (e.g. 192.168.1.100)'
    }
    if (formData.cpu < 1) {
      newErrors.cpu = 'CPU must be at least 1'
    }
    if (formData.memory < 512) {
      newErrors.memory = 'Memory must be at least 512 MB'
    }
    if (formData.storage < 10) {
      newErrors.storage = 'Storage must be at least 10 GB'
    }
    if (formData.maxTasks < 1) {
      newErrors.maxTasks = 'Max tasks must be at least 1'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return

    const nodeData: Partial<EdgeNode> = {
      name: formData.name,
      location: formData.location,
      region: formData.region,
      ip: formData.ip,
      cpu: formData.cpu,
      memory: formData.memory,
      storage: formData.storage,
      costPerHour: formData.costPerHour,
      maxTasks: formData.maxTasks,
      status: 'offline',
      tasksRunning: 0,
      latency: 0,
      uptime: 0,
      url: `http://${formData.ip}:4001`,
      bandwidthIn: 0,
      bandwidthOut: 0,
      healthHistory: [],
      isMaintenanceMode: false,
    }

    onSubmit(nodeData)
    
    // Reset form
    setFormData({
      name: '',
      location: '',
      region: 'us-east-1',
      nodeType: 'edge',
      ip: '',
      cpu: 4,
      memory: 8192,
      storage: 100,
      costPerHour: 0.05,
      maxTasks: 10,
    })
    setErrors({})
  }

  const handleClose = () => {
    setErrors({})
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
          >
            <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Server className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Register New Node</h2>
                    <p className="text-sm text-muted-foreground">
                      Add a new edge or cloud node to your infrastructure
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="rounded-full p-2 hover:bg-secondary transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Basic Information */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Basic Information
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="name" className="text-sm font-medium">
                        Node Name <span className="text-destructive">*</span>
                      </label>
                      <Input
                        id="name"
                        placeholder="e.g., edge-mumbai-01"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={errors.name ? 'border-destructive' : ''}
                      />
                      {errors.name && (
                        <p className="text-xs text-destructive">{errors.name}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="location" className="text-sm font-medium">
                        Location <span className="text-destructive">*</span>
                      </label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="location"
                          placeholder="e.g., Mumbai, India"
                          value={formData.location}
                          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                          className={`pl-10 ${errors.location ? 'border-destructive' : ''}`}
                        />
                      </div>
                      {errors.location && (
                        <p className="text-xs text-destructive">{errors.location}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="region" className="text-sm font-medium">Region</label>
                      <Select
                        value={formData.region}
                        onValueChange={(value) => setFormData({ ...formData, region: value })}
                      >
                        <SelectTrigger>
                          <Globe className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REGIONS.map((region) => (
                            <SelectItem key={region} value={region}>
                              {region}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="nodeType" className="text-sm font-medium">Node Type</label>
                      <Select
                        value={formData.nodeType}
                        onValueChange={(value) => setFormData({ ...formData, nodeType: value })}
                      >
                        <SelectTrigger>
                          <Server className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NODE_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="ip" className="text-sm font-medium">
                      IP Address <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <Wifi className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="ip"
                        placeholder="e.g., 192.168.1.100"
                        value={formData.ip}
                        onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                        className={`pl-10 ${errors.ip ? 'border-destructive' : ''}`}
                      />
                    </div>
                    {errors.ip && (
                      <p className="text-xs text-destructive">{errors.ip}</p>
                    )}
                  </div>
                </div>

                {/* Resources */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Resource Configuration
                  </h3>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="cpu" className="text-sm font-medium">
                        CPU Cores <span className="text-destructive">*</span>
                      </label>
                      <div className="relative">
                        <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="cpu"
                          type="number"
                          min={1}
                          max={128}
                          value={formData.cpu}
                          onChange={(e) => setFormData({ ...formData, cpu: parseInt(e.target.value) || 0 })}
                          className={`pl-10 ${errors.cpu ? 'border-destructive' : ''}`}
                        />
                      </div>
                      {errors.cpu && (
                        <p className="text-xs text-destructive">{errors.cpu}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="memory" className="text-sm font-medium">
                        Memory (MB) <span className="text-destructive">*</span>
                      </label>
                      <Input
                        id="memory"
                        type="number"
                        min={512}
                        step={512}
                        value={formData.memory}
                        onChange={(e) => setFormData({ ...formData, memory: parseInt(e.target.value) || 0 })}
                        className={errors.memory ? 'border-destructive' : ''}
                      />
                      {errors.memory && (
                        <p className="text-xs text-destructive">{errors.memory}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="storage" className="text-sm font-medium">
                        Storage (GB) <span className="text-destructive">*</span>
                      </label>
                      <div className="relative">
                        <HardDrive className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="storage"
                          type="number"
                          min={10}
                          value={formData.storage}
                          onChange={(e) => setFormData({ ...formData, storage: parseInt(e.target.value) || 0 })}
                          className={`pl-10 ${errors.storage ? 'border-destructive' : ''}`}
                        />
                      </div>
                      {errors.storage && (
                        <p className="text-xs text-destructive">{errors.storage}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="maxTasks" className="text-sm font-medium">Max Concurrent Tasks</label>
                      <Input
                        id="maxTasks"
                        type="number"
                        min={1}
                        max={100}
                        value={formData.maxTasks}
                        onChange={(e) => setFormData({ ...formData, maxTasks: parseInt(e.target.value) || 0 })}
                        className={errors.maxTasks ? 'border-destructive' : ''}
                      />
                      {errors.maxTasks && (
                        <p className="text-xs text-destructive">{errors.maxTasks}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="costPerHour" className="text-sm font-medium">Cost Per Hour ($)</label>
                      <Input
                        id="costPerHour"
                        type="number"
                        min={0}
                        step={0.01}
                        value={formData.costPerHour}
                        onChange={(e) => setFormData({ ...formData, costPerHour: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    Register Node
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
