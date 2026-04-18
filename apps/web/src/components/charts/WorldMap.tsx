import { useMemo } from 'react'
import type { EdgeNode } from '../../types'

interface WorldMapProps {
  nodes: EdgeNode[]
  className?: string
}

// Simplified world map with major regions
const REGIONS = [
  { id: 'us-east', name: 'US East', x: 280, y: 180, city: 'New York' },
  { id: 'us-west', name: 'US West', x: 150, y: 190, city: 'San Francisco' },
  { id: 'eu-west', name: 'EU West', x: 480, y: 150, city: 'London' },
  { id: 'eu-central', name: 'EU Central', x: 510, y: 160, city: 'Frankfurt' },
  { id: 'apac-south', name: 'APAC South', x: 700, y: 280, city: 'Singapore' },
  { id: 'apac-north', name: 'APAC North', x: 780, y: 170, city: 'Tokyo' },
  { id: 'apac-oceania', name: 'Oceania', x: 800, y: 380, city: 'Sydney' },
  { id: 'latam', name: 'LATAM', x: 320, y: 320, city: 'Sao Paulo' },
  { id: 'apac-india', name: 'India', x: 620, y: 240, city: 'Mumbai' },
  { id: 'me-south', name: 'ME South', x: 560, y: 210, city: 'Dubai' },
]

export function WorldMap({ nodes, className }: WorldMapProps) {
  const regionStatus = useMemo(() => {
    const status: Record<string, { count: number; status: EdgeNode['status'] }> = {}
    
    REGIONS.forEach(region => {
      const regionNodes = nodes.filter(n => n.region === region.id)
      if (regionNodes.length === 0) {
        status[region.id] = { count: 0, status: 'offline' }
      } else {
        const onlineCount = regionNodes.filter(n => n.status === 'online').length
        const hasDegraded = regionNodes.some(n => n.status === 'degraded')
        // const hasOffline = regionNodes.some(n => n.status === 'offline')
        
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
  
  const getStatusColor = (status: EdgeNode['status']) => {
    switch (status) {
      case 'online': return 'hsl(145, 70%, 45%)'
      case 'degraded': return 'hsl(38, 92%, 50%)'
      case 'offline': return 'hsl(0, 72%, 55%)'
      default: return 'hsl(220, 10%, 40%)'
    }
  }
  
  return (
    <div className={className}>
      <svg viewBox="0 0 900 450" className="w-full h-full">
        {/* Simplified world map background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.3"/>
          </pattern>
        </defs>
        
        {/* Background */}
        <rect width="900" height="450" fill="hsl(var(--card))" rx="12" />
        <rect width="900" height="450" fill="url(#grid)" rx="12" />
        
        {/* Continents (simplified shapes) */}
        <g fill="hsl(var(--muted))" opacity="0.3">
          {/* North America */}
          <path d="M 50 80 Q 150 50 250 100 L 280 180 L 200 250 L 100 200 Z" />
          {/* South America */}
          <path d="M 280 280 L 350 280 L 380 380 L 300 420 L 250 350 Z" />
          {/* Europe */}
          <path d="M 450 100 L 550 100 L 580 180 L 480 190 Z" />
          {/* Africa */}
          <path d="M 480 200 L 580 200 L 600 350 L 500 380 Z" />
          {/* Asia */}
          <path d="M 580 80 L 850 80 L 880 250 L 700 300 L 600 200 Z" />
          {/* Australia */}
          <path d="M 750 350 L 850 350 L 860 420 L 760 420 Z" />
        </g>
        
        {/* Region markers */}
        {REGIONS.map((region) => {
          const status = regionStatus[region.id]
          const color = getStatusColor(status?.status || 'offline')
          
          return (
            <g key={region.id}>
              {/* Pulse effect for online nodes */}
              {status?.status === 'online' && status.count > 0 && (
                <circle
                  cx={region.x}
                  cy={region.y}
                  r="12"
                  fill={color}
                  opacity="0.3"
                >
                  <animate
                    attributeName="r"
                    values="12;20;12"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.3;0;0.3"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              
              {/* Main dot */}
              <circle
                cx={region.x}
                cy={region.y}
                r={status?.count ? 8 : 4}
                fill={color}
                stroke="hsl(var(--card))"
                strokeWidth="2"
              />
              
              {/* Label */}
              <text
                x={region.x}
                y={region.y + 20}
                textAnchor="middle"
                fill="hsl(var(--foreground))"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {region.city}
              </text>
              
              {/* Node count */}
              {status && status.count > 0 && (
                <text
                  x={region.x}
                  y={region.y - 12}
                  textAnchor="middle"
                  fill={color}
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {status.count}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      
      {/* Legend */}
      <div className="flex justify-center gap-4 mt-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-success" />
          <span className="text-muted-foreground">Online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-warning" />
          <span className="text-muted-foreground">Degraded</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
          <span className="text-muted-foreground">Offline</span>
        </div>
      </div>
    </div>
  )
}
