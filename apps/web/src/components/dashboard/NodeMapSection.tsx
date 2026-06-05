import { useState } from "react";
import { Globe, Leaf, Target, Crosshair } from "lucide-react";
import { WorldMap } from "../charts/WorldMap";
import { cn } from "../../lib/utils";
import type { EdgeNode } from "../../types";
import { motion } from "framer-motion";

interface NodeMapSectionProps {
  nodes: EdgeNode[];
  className?: string;
}

export function NodeMapSection({ nodes, className }: NodeMapSectionProps) {
  const [carbonMode, setCarbonMode] = useState(false);

  return (
    <div className={cn("card-brief p-6 flex flex-col h-[400px]", className)}>
      <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">
            Global Operations
          </h3>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4 text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Nominal</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span>Degraded</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCarbonMode((s) => !s)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest font-black rounded-md border transition-all",
              carbonMode
                ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                : "border-border text-muted-foreground hover:text-foreground hover:border-primary/50",
            )}
          >
            <Leaf className="h-3 w-3" />{" "}
            {carbonMode ? "Carbon: Optimized" : "Carbon Intensity"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative group">
        <WorldMap
          nodes={nodes}
          carbonMode={carbonMode}
          className="h-full border-none bg-transparent"
        />

        {/* Overlay decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none border border-primary/5 rounded-xl overflow-hidden">
          <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-20 group-hover:opacity-100 transition-opacity">
            <Crosshair className="h-4 w-4 text-primary animate-pulse" />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.05 }}
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_#000_100%)]"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
              Active Regions
            </span>
            <span className="text-xs font-black font-mono text-foreground">
              12 / 12
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
              Uplink Stat
            </span>
            <span className="text-xs font-black font-mono text-primary">
              ENCRYPTED
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
          <Target className="h-3 w-3" />
          <span>LAT: 40.7128° N | LON: 74.0060° W</span>
        </div>
      </div>
    </div>
  );
}
