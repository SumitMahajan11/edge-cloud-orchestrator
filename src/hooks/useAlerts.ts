import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { AlertRuleConfig as AlertRule, EdgeNode, Task } from '../types'
import { generateId } from '../lib/utils'

interface Alert {
  id: string
  ruleId: string
  ruleName: string
  message: string
  severity: 'critical' | 'warning' | 'info'
  timestamp: Date
  acknowledged: boolean
  nodeId?: string
  metric: string
  value: number
  threshold: number
}

const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'cpu-high',
    name: 'High CPU Usage',
    metric: 'cpu',
    operator: '>',
    threshold: 85,
    duration: 2,
    enabled: true,
    createdAt: new Date(),
  },
  {
    id: 'memory-high',
    name: 'High Memory Usage',
    metric: 'memory',
    operator: '>',
    threshold: 80,
    duration: 3,
    enabled: true,
    createdAt: new Date(),
  },
  {
    id: 'latency-high',
    name: 'High Latency',
    metric: 'latency',
    operator: '>',
    threshold: 150,
    duration: 5,
    enabled: true,
    createdAt: new Date(),
  },
  {
    id: 'node-offline',
    name: 'Node Offline',
    metric: 'uptime',
    operator: '<',
    threshold: 50,
    duration: 1,
    enabled: true,
    createdAt: new Date(),
  },
]

export function useAlerts(nodes: EdgeNode[], _tasks: Task[]) {
  const [rules, setRules] = useState<AlertRule[]>(DEFAULT_RULES)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [isEnabled, setIsEnabled] = useState(true)
  
  // Track metric history for duration checks
  const metricHistory = useRef<Map<string, { timestamp: number; value: number }[]>>(new Map())
  
  // Load rules from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('alert_rules')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setRules(parsed.map((r: AlertRule) => ({
          ...r,
          createdAt: new Date(r.createdAt),
        })))
      } catch {
        console.error('Failed to load alert rules')
      }
    }
  }, [])
  
  // Save rules to localStorage
  useEffect(() => {
    localStorage.setItem('alert_rules', JSON.stringify(rules))
  }, [rules])
  
  // Evaluate rules against current metrics
  useEffect(() => {
    if (!isEnabled) return
    
    const newAlerts: Alert[] = []
    const now = Date.now()
    
    rules.forEach(rule => {
      if (!rule.enabled) return
      
      nodes.forEach(node => {
        let value: number | undefined
        
        switch (rule.metric) {
          case 'cpu':
            value = node.cpu
            break
          case 'memory':
            value = node.memory
            break
          case 'latency':
            value = node.latency
            break
          case 'uptime':
            value = node.uptime
            break
        }
        
        if (value === undefined) return
        
        // Check if threshold is breached
        let isBreached = false
        switch (rule.operator) {
          case '>':
            isBreached = value > rule.threshold
            break
          case '<':
            isBreached = value < rule.threshold
            break
          case '>=':
            isBreached = value >= rule.threshold
            break
          case '<=':
            isBreached = value <= rule.threshold
            break
          case '==':
            isBreached = value === rule.threshold
            break
        }
        
        if (isBreached) {
          // Track history for this metric
          const key = `${node.id}-${rule.metric}`
          const history = metricHistory.current.get(key) || []
          history.push({ timestamp: now, value })
          
          // Keep only last 10 minutes of history
          const cutoff = now - 10 * 60 * 1000
          const filtered = history.filter(h => h.timestamp > cutoff)
          metricHistory.current.set(key, filtered)
          
          // Check if condition persisted for required duration
          const durationMs = rule.duration * 60 * 1000
          const sustained = filtered.length >= 2 && 
            (now - filtered[0].timestamp) >= durationMs
          
          if (sustained) {
            // Check if alert already exists and not acknowledged
            const existingAlert = alerts.find(a => 
              a.ruleId === rule.id && 
              a.nodeId === node.id && 
              !a.acknowledged &&
              (now - a.timestamp.getTime()) < 30 * 60 * 1000 // 30 min deduplication
            )
            
            if (!existingAlert) {
              const severity: Alert['severity'] = 
                rule.metric === 'uptime' && value < 10 ? 'critical' :
                value > rule.threshold * 1.2 ? 'critical' :
                value > rule.threshold * 1.1 ? 'warning' : 'info'
              
              const alert: Alert = {
                id: generateId(),
                ruleId: rule.id,
                ruleName: rule.name,
                message: `${node.name}: ${rule.metric} is ${value.toFixed(1)} (threshold: ${rule.threshold})`,
                severity,
                timestamp: new Date(),
                acknowledged: false,
                nodeId: node.id,
                metric: rule.metric,
                value,
                threshold: rule.threshold,
              }
              
              newAlerts.push(alert)
              
              // Show toast notification
              toast[severity === 'critical' ? 'error' : severity](
                `${rule.name}: ${node.name}`,
                {
                  description: `${rule.metric}: ${value.toFixed(1)} (threshold: ${rule.threshold})`,
                  duration: severity === 'critical' ? 10000 : 5000,
                }
              )
            }
          }
        } else {
          // Clear history if condition resolved
          metricHistory.current.delete(`${node.id}-${rule.metric}`)
        }
      })
    })
    
    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 100)) // Keep last 100 alerts
    }
  }, [nodes, rules, isEnabled, alerts])
  
  const addRule = useCallback((rule: Omit<AlertRule, 'id' | 'createdAt'>) => {
    const newRule: AlertRule = {
      ...rule,
      id: generateId(),
      createdAt: new Date(),
    }
    setRules(prev => [...prev, newRule])
  }, [])
  
  const updateRule = useCallback((ruleId: string, updates: Partial<AlertRule>) => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, ...updates } : r
    ))
  }, [])
  
  const deleteRule = useCallback((ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId))
  }, [])
  
  const acknowledgeAlert = useCallback((alertId: string) => {
    setAlerts(prev => prev.map(a => 
      a.id === alertId ? { ...a, acknowledged: true } : a
    ))
  }, [])
  
  const clearAlerts = useCallback(() => {
    setAlerts([])
    metricHistory.current.clear()
  }, [])
  
  const toggleEnabled = useCallback(() => {
    setIsEnabled(prev => !prev)
  }, [])
  
  const activeAlerts = alerts.filter(a => !a.acknowledged)
  const criticalCount = activeAlerts.filter(a => a.severity === 'critical').length
  const warningCount = activeAlerts.filter(a => a.severity === 'warning').length
  
  return {
    rules,
    alerts,
    activeAlerts,
    isEnabled,
    stats: {
      total: alerts.length,
      active: activeAlerts.length,
      critical: criticalCount,
      warning: warningCount,
      info: activeAlerts.filter(a => a.severity === 'info').length,
    },
    addRule,
    updateRule,
    deleteRule,
    acknowledgeAlert,
    clearAlerts,
    toggleEnabled,
  }
}
