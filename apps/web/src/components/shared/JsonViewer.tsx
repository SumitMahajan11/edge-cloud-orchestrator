import { cn } from "../../lib/utils"

interface JsonViewerProps {
  data: any
  className?: string
  maxHeight?: string
}

export function JsonViewer({ data, className, maxHeight = "400px" }: JsonViewerProps) {
  const formatJson = (obj: any) => {
    try {
      const json = JSON.stringify(obj, null, 2)
      return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'text-sky-400' // Default for numbers
        
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-muted-foreground font-medium' // Keys
          } else {
            // Strings - check if it looks like a TraceID or NodeID
            const cleanStr = match.slice(1, -1)
            if (/^[0-9a-f]{32}$/i.test(cleanStr)) {
              cls = 'text-primary font-bold underline decoration-primary/30 underline-offset-4' // TraceID
            } else if (/^[0-9a-f]{16}$/i.test(cleanStr)) {
              cls = 'text-indigo-400 font-bold' // SpanID
            } else if (cleanStr.startsWith('node_') || cleanStr.startsWith('tsk_')) {
              cls = 'text-primary' // Entity IDs
            } else {
              cls = 'text-emerald-400' // Standard Strings
            }
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-amber-500' // Booleans
        } else if (/null/.test(match)) {
          cls = 'text-slate-600' // Null
        }
        return `<span class="${cls}">${match}</span>`
      })
    } catch (e) {
      return String(obj)
    }
  }

  return (
    <div 
      className={cn(
        "rounded-xl border border-border/50 bg-[#050508] p-5 font-mono text-[11px] leading-relaxed overflow-auto scrollbar-thin",
        className
      )}
      style={{ maxHeight }}
    >
      <pre 
        className="whitespace-pre-wrap break-all"
        dangerouslySetInnerHTML={{ __html: formatJson(data) }}
      />
    </div>
  )
}
