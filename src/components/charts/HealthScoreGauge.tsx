import { useMemo } from 'react'

interface HealthScoreGaugeProps {
  score: number
  size?: number
  className?: string
}

export function HealthScoreGauge({ score, size = 120, className }: HealthScoreGaugeProps) {
  const radius = (size - 16) / 2
  const strokeWidth = 10
  const normalizedRadius = radius - strokeWidth / 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (score / 100) * circumference
  
  const color = useMemo(() => {
    if (score >= 80) return 'hsl(145, 70%, 45%)' // success
    if (score >= 60) return 'hsl(38, 92%, 50%)' // warning
    return 'hsl(0, 72%, 55%)' // destructive
  }, [score])
  
  const getStatusText = () => {
    if (score >= 80) return 'Healthy'
    if (score >= 60) return 'Warning'
    return 'Critical'
  }
  
  return (
    <div className={className} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={normalizedRadius}
          cx={size / 2}
          cy={size / 2}
          opacity="0.3"
        />
        
        {/* Progress circle */}
        <circle
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.5s ease' }}
          strokeLinecap="round"
          fill="transparent"
          r={normalizedRadius}
          cx={size / 2}
          cy={size / 2}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      
      {/* Center text */}
      <div 
        className="absolute flex flex-col items-center justify-center"
        style={{ 
          width: size - strokeWidth * 2, 
          height: size - strokeWidth * 2,
          top: strokeWidth,
          left: strokeWidth
        }}
      >
        <span className="text-2xl font-bold font-mono" style={{ color }}>
          {Math.round(score)}
        </span>
        <span className="text-xs text-muted-foreground">{getStatusText()}</span>
      </div>
    </div>
  )
}
