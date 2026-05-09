import { useMemo } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from 'react-simple-maps'
import { motion } from 'framer-motion'
import type { EdgeNode } from '../../types'
import { cn } from '../../lib/utils'

interface WorldMapProps {
  nodes: EdgeNode[]
  className?: string
  carbonMode?: boolean
}

const geoUrl = 'https://unpkg.com/world-atlas@2.0.2/countries-110m.json'

const REGIONS = [
  { id: 'us-east', name: 'US East', coordinates: [-74.006, 40.7128], city: 'New York' },
  { id: 'us-west', name: 'US West', coordinates: [-122.4194, 37.7749], city: 'San Francisco' },
  { id: 'eu-west', name: 'EU West', coordinates: [-0.1278, 51.5074], city: 'London' },
  { id: 'eu-central', name: 'EU Central', coordinates: [8.6821, 50.1109], city: 'Frankfurt' },
  { id: 'apac-south', name: 'APAC South', coordinates: [103.8198, 1.3521], city: 'Singapore' },
  { id: 'apac-north', name: 'APAC North', coordinates: [139.6917, 35.6895], city: 'Tokyo' },
  { id: 'apac-oceania', name: 'Oceania', coordinates: [151.2093, -33.8688], city: 'Sydney' },
  { id: 'latam', name: 'LATAM', coordinates: [-46.6333, -23.5505], city: 'Sao Paulo' },
  { id: 'apac-india', name: 'India', coordinates: [72.8777, 19.076], city: 'Mumbai' },
  { id: 'me-south', name: 'ME South', coordinates: [55.2708, 25.2048], city: 'Dubai' },
]

const CONNECTIONS = [
  ['us-east', 'eu-west'],
  ['us-west', 'apac-north'],
  ['eu-central', 'me-south'],
  ['apac-south', 'apac-oceania'],
  ['us-east', 'latam'],
  ['eu-west', 'apac-india'],
] as const

export function WorldMap({ nodes, className, carbonMode }: WorldMapProps) {
  const regionStatus = useMemo(() => {
    const status: Record<string, { count: number; status: EdgeNode['status'] }> = {}
    
    REGIONS.forEach(region => {
      const regionNodes = nodes.filter(n => n.region === region.id)
      if (regionNodes.length === 0) {
        status[region.id] = { count: 0, status: 'offline' }
      } else {
        const onlineCount = regionNodes.filter(n => n.status === 'online').length
        const hasDegraded = regionNodes.some(n => n.status === 'degraded')
        
        if (onlineCount === regionNodes.length) {
          status[region.id] = { count: regionNodes.length, status: 'online' }
        } else if (hasDegraded) {
          status[region.id] = { count: regionNodes.length, status: 'degraded' }
        } else {
          status[region.id] = { count: regionNodes.length, status: 'offline' }
        }
      }
    })
    
    return status
  }, [nodes])

  const carbonIntensities = useMemo(() => {
    const intensities: Record<string, number> = {}
    REGIONS.forEach(r => {
      const hash = r.id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0) & 0xffff
      intensities[r.id] = 100 + (hash % 450)
    })
    return intensities
  }, [])
  
  const getStatusColor = (regionId: string, status: EdgeNode['status']) => {
    if (carbonMode) {
      const intensity = carbonIntensities[regionId] ?? 0
      if (intensity < 200) return '#10b981'
      if (intensity < 400) return '#f59e0b'
      return '#ef4444'
    }
    switch (status) {
      case 'online': return '#00d4aa'
      case 'degraded': return '#f59e0b'
      case 'offline': return '#ef4444'
      default: return '#3f3f46'
    }
  }
  
  return (
    <div className={cn("relative group bg-[#050508] rounded-xl overflow-hidden border border-border/50 h-full", className)}>
      <ComposableMap
        projectionConfig={{
          rotate: [-10, 0, 0],
          scale: 147
        }}
        className="w-full h-full"
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="currentColor"
                className={cn(
                  "text-muted-foreground/5 transition-colors duration-1000 outline-none",
                  carbonMode && "text-emerald-500/10"
                )}
                stroke="#ffffff05"
                strokeWidth={0.5}
              />
            ))
          }
        </Geographies>

        {/* Data Connections */}
        <g opacity="0.3">
          {CONNECTIONS.map(([startId, endId]) => {
            const start = REGIONS.find(r => r.id === startId)!
            const end = REGIONS.find(r => r.id === endId)!
            const isActive = (startId && endId) ? ((regionStatus[startId]?.status || 'offline') === 'online' && (regionStatus[endId]?.status || 'offline') === 'online') : false
            
            return (
              <Line
                key={`${startId}-${endId}`}
                from={start.coordinates as [number, number]}
                to={end.coordinates as [number, number]}
                stroke={isActive ? "#00d4aa" : "#3f3f46"}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )
          })}
        </g>

        {/* Markers */}
        {REGIONS.map((region) => {
          const status = regionStatus[region.id]
          const color = getStatusColor(region.id, status?.status || 'offline')
          const intensity = carbonIntensities[region.id]
          
          return (
            <Marker key={region.id} coordinates={region.coordinates as [number, number]}>
              <g className="cursor-pointer group/node">
                <motion.circle
                  r="10"
                  fill={color}
                  animate={{ 
                    opacity: status?.status === 'online' ? [0.1, 0.4, 0.1] : 0,
                    scale: status?.status === 'online' ? [1, 1.4, 1] : 1
                  }}
                  transition={{ duration: 3, repeat: Infinity }}
                />
                
                <circle
                  r={status?.count ? 4 : 2}
                  fill={color}
                  stroke="#050508"
                  strokeWidth="1.5"
                />
                
                <text
                  textAnchor="middle"
                  y={12}
                  className="text-[6px] font-mono font-bold tracking-tighter fill-muted-foreground group-hover/node:fill-primary transition-colors pointer-events-none uppercase"
                >
                  {region.city}
                </text>
                
                {status && status.count > 0 && !carbonMode && (
                  <text
                    textAnchor="middle"
                    y={-6}
                    fill={color}
                    className="text-[6px] font-mono font-black pointer-events-none"
                  >
                    {status.count}
                  </text>
                )}
                
                {carbonMode && (
                  <text
                    textAnchor="middle"
                    y={-6}
                    fill={color}
                    className="text-[5px] font-mono font-black pointer-events-none"
                  >
                    {intensity}g
                  </text>
                )}
              </g>
            </Marker>
          )
        })}
      </ComposableMap>
      
      {/* HUD Info */}
      <div className="absolute bottom-3 left-3 font-mono text-[8px] text-muted-foreground/40 flex flex-col gap-0.5 pointer-events-none">
        <div className="flex gap-2">
          <span className="text-primary/50 font-bold">MODE:</span>
          <span>{carbonMode ? 'CARBON_OPTIMIZED' : 'STANDARD_OPS'}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-primary/50 font-bold">STAT:</span>
          <span className="animate-pulse text-primary/80">LIVE_TELEMETRY</span>
        </div>
      </div>
    </div>
  )
}
