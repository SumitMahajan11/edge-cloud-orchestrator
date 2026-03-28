import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'edge-cloud-orchestrator'

interface PersistedState {
  theme: 'dark' | 'light'
  logRetentionSize: number
  autoScrollLogs: boolean
  updateInterval: number
  defaultPolicy: string
  dashboardTimeRange: string
  version: number
}

const DEFAULT_STATE: PersistedState = {
  theme: 'dark',
  logRetentionSize: 500,
  autoScrollLogs: true,
  updateInterval: 2000,
  defaultPolicy: 'latency-aware',
  dashboardTimeRange: '5m',
  version: 1,
}

export function usePersistentState() {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE)
  const [isLoaded, setIsLoaded] = useState(false)
  
  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setState({ ...DEFAULT_STATE, ...parsed })
      }
    } catch (error) {
      console.error('Failed to load persisted state:', error)
    }
    setIsLoaded(true)
  }, [])
  
  // Save to localStorage when state changes
  useEffect(() => {
    if (!isLoaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save persisted state:', error)
    }
  }, [state, isLoaded])
  
  const updateState = useCallback((updates: Partial<PersistedState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])
  
  const resetState = useCallback(() => {
    setState(DEFAULT_STATE)
    localStorage.removeItem(STORAGE_KEY)
  }, [])
  
  return {
    state,
    isLoaded,
    updateState,
    resetState,
  }
}

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(defaultValue)
  const [isLoaded, setIsLoaded] = useState(false)
  
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        setValue(JSON.parse(stored))
      }
    } catch (error) {
      console.error(`Failed to load ${key} from localStorage:`, error)
    }
    setIsLoaded(true)
  }, [key])
  
  useEffect(() => {
    if (!isLoaded) return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.error(`Failed to save ${key} to localStorage:`, error)
    }
  }, [key, value, isLoaded])
  
  const setStoredValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue(prev => {
      const valueToStore = newValue instanceof Function ? newValue(prev) : newValue
      return valueToStore
    })
  }, [])
  
  return [value, setStoredValue]
}
