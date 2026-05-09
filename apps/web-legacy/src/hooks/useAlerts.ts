import { useQuery } from '@tanstack/react-query'
import { getV2Alerts } from '@edgecloud/api-client'

export interface SystemAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  message: string
  source: string
  timestamp: number
  acknowledged: boolean
  metadata?: Record<string, any>
}

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      try {
        const { data, error } = await getV2Alerts()
        if (error) throw error
        return data as unknown as SystemAlert[]
      } catch (err) {
        return MOCK_ALERTS
      }
    },
    refetchInterval: 10000,
  })
}

const MOCK_ALERTS: SystemAlert[] = [
  {
    id: 'alt-1',
    severity: 'critical',
    title: 'Edge Node Latency Spike',
    message: 'Multiple nodes in us-east region reporting p99 latency > 2s.',
    source: 'monitoring.latency',
    timestamp: Date.now() - 1000 * 60 * 15,
    acknowledged: false,
    metadata: { region: 'us-east', affectedNodes: 12 }
  },
  {
    id: 'alt-2',
    severity: 'warning',
    title: 'Model Drift Detected',
    message: 'Scheduling accuracy dropped below 90% threshold in APAC.',
    source: 'ml.optimizer',
    timestamp: Date.now() - 1000 * 60 * 45,
    acknowledged: false,
    metadata: { model: 'XGBoost-v4', driftScore: 0.48 }
  },
  {
    id: 'alt-3',
    severity: 'info',
    title: 'Scheduled Retraining Started',
    message: 'Auto-retraining job initiated for global scheduler model.',
    source: 'system.cron',
    timestamp: Date.now() - 1000 * 60 * 120,
    acknowledged: true
  }
]
