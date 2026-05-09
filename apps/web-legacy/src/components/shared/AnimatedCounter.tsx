import { useEffect, useState, useRef } from 'react'
import { cn } from '../../lib/utils'

interface AnimatedCounterProps {
  value: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}

export function AnimatedCounter({
  value,
  duration = 1000,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const startValueRef = useRef(0)
  const previousValueRef = useRef(value)
  
  useEffect(() => {
    if (previousValueRef.current === value) return
    
    startValueRef.current = displayValue
    previousValueRef.current = value
    startTimeRef.current = null
    
    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime
      }
      
      const elapsed = currentTime - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      
      // Easing function (ease-out-cubic)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      
      const currentValue = startValueRef.current + (value - startValueRef.current) * easeOut
      setDisplayValue(currentValue)
      
      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }
    
    requestAnimationFrame(animate)
  }, [value, duration, displayValue])
  
  const formattedValue = displayValue.toFixed(decimals)
  
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  )
}
