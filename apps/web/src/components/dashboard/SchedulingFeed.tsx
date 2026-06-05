import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, Terminal, Layers } from "lucide-react";
import { useWsEventStream } from "../../stores/websocket";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SchedulingFeedProps {
  cpuHistory: { timestamp: Date; value: number }[];
  paused?: boolean;
  onTogglePaused?: () => void;
}

export function SchedulingFeed({
  cpuHistory,
  paused,
  onTogglePaused,
}: SchedulingFeedProps) {
  const [tab, setTab] = useState<"feed" | "events" | "cpu">("feed");
  const schedulingEvents = useWsEventStream("scheduler.");
  const allEvents = useWsEventStream();

  const feedRows = useMemo(
    () => [...schedulingEvents].reverse().slice(0, 50),
    [schedulingEvents],
  );
  const eventRows = useMemo(
    () => [...allEvents].reverse().slice(0, 50),
    [allEvents],
  );

  const cpuChart = useMemo(
    () =>
      cpuHistory.map((p, i) => ({
        name: `${i * 2}s`,
        cpu: Math.round(p.value),
      })),
    [cpuHistory],
  );

  return (
    <div className="card-brief p-6 flex flex-col h-[400px]">
      <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">
            Control Center
          </h3>
        </div>

        <div className="flex items-center gap-4">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            className="w-auto"
          >
            <TabsList className="bg-secondary/50 h-8 border-none">
              <TabsTrigger value="feed" className="text-[10px] h-7 px-3">
                Live Decisions
              </TabsTrigger>
              <TabsTrigger value="events" className="text-[10px] h-7 px-3">
                Event Stream
              </TabsTrigger>
              <TabsTrigger value="cpu" className="text-[10px] h-7 px-3">
                Perf
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {onTogglePaused && (
            <button
              type="button"
              onClick={onTogglePaused}
              className={cn(
                "p-1.5 rounded-md border transition-all",
                paused
                  ? "text-primary border-primary/30 bg-primary/10"
                  : "text-muted-foreground border-border hover:border-primary/50",
              )}
            >
              {paused ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {tab === "feed" && (
            <motion.div
              key="feed"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="h-full"
            >
              <ScrollArea className="h-full">
                <div className="space-y-1 pr-3 font-mono text-[11px]">
                  {feedRows.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground opacity-30">
                      <Layers className="h-8 w-8 mb-2" />
                      <p>Initializing Decision Matrix...</p>
                    </div>
                  )}
                  {feedRows.map((e) => {
                    const d: any = e.data ?? {};
                    const outcome = inferOutcome(d, e.type);
                    return (
                      <motion.div
                        key={e.id}
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn(
                          "flex items-center gap-4 py-1.5 px-3 rounded hover:bg-white/5 transition-colors group border border-transparent hover:border-border/20",
                          outcome === "failed" &&
                            "bg-destructive/5 text-destructive border-destructive/10",
                        )}
                      >
                        <span className="text-muted-foreground tabular-nums w-12 shrink-0">
                          {fmtTime(e.receivedAt)}
                        </span>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-foreground font-bold truncate">
                            TSK:{(d.taskId || "—").slice(0, 8)}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-primary truncate font-bold">
                            NOD:
                            {(d.nodeId ?? d.selectedNodeId ?? "—").slice(0, 8)}
                          </span>
                          {d.runtime && (
                            <span className="text-[9px] px-1 bg-secondary rounded text-muted-foreground font-mono ml-2">
                              {d.runtime}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-muted-foreground tabular-nums">
                            {fmtLatency(d)}
                          </span>
                          <div
                            className={cn(
                              "px-1.5 py-0.5 rounded-[4px] text-[9px] font-black tracking-widest border",
                              outcome === "ml"
                                ? "text-primary border-primary/30 bg-primary/5"
                                : outcome === "fallback"
                                  ? "text-amber-500 border-amber-500/30 bg-amber-500/5"
                                  : "text-destructive border-destructive/30 bg-destructive/5",
                            )}
                          >
                            {outcomeLabel(outcome)}
                          </div>
                          <span className="text-muted-foreground tabular-nums w-14 text-right">
                            {fmtCost(d)}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </ScrollArea>
            </motion.div>
          )}

          {tab === "events" && (
            <motion.div
              key="events"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="h-full"
            >
              <ScrollArea className="h-full">
                <div className="space-y-1 pr-3 font-mono text-[11px]">
                  {eventRows.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-4 py-1.5 px-3 rounded hover:bg-white/5 transition-colors border border-transparent hover:border-border/20"
                    >
                      <span className="text-muted-foreground tabular-nums w-12 shrink-0">
                        {fmtTime(e.receivedAt)}
                      </span>
                      <span className="text-indigo-400 font-bold shrink-0 w-32 truncate">
                        {e.type.toUpperCase()}
                      </span>
                      <span className="text-muted-foreground truncate flex-1">
                        {safeSummary(e.data)}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </motion.div>
          )}

          {tab === "cpu" && (
            <motion.div
              key="cpu"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="h-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={cpuChart}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#00d4aa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#ffffff08"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    stroke="#6b7280"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#6b7280"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#050508",
                      border: "1px solid #ffffff10",
                      borderRadius: "4px",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    stroke="#00d4aa"
                    strokeWidth={2}
                    fill="url(#cpuGrad)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

function fmtLatency(d: any): string {
  const ms = Number(d?.latencyMs ?? d?.latency ?? d?.durationMs ?? 0);
  return Number.isFinite(ms) && ms > 0 ? `${Math.round(ms)}ms` : "—";
}

function fmtCost(d: any): string {
  const cost = Number(d?.cost ?? d?.estimatedCost ?? 0);
  return Number.isFinite(cost) && cost > 0 ? `$${cost.toFixed(3)}` : "—";
}

function inferOutcome(
  d: any,
  type: string,
): "ml" | "fallback" | "failed" | "unknown" {
  if (type.includes("failed")) return "failed";
  if (d?.fallbackUsed === true || d?.mlModelVersion == null) return "fallback";
  if (d?.mlModelVersion) return "ml";
  if (d?.policy === "ml-optimized") return "ml";
  return "unknown";
}

function outcomeLabel(o: string): string {
  if (o === "ml") return "ML_OPT";
  if (o === "fallback") return "FALLBACK";
  if (o === "failed") return "FAIL";
  return "—";
}

function safeSummary(d: any): string {
  if (!d || typeof d !== "object") return String(d ?? "");
  const keys = ["taskId", "nodeId", "message", "status", "reason", "policy"];
  for (const k of keys) {
    if (d[k]) return `${k.toUpperCase()}: ${String(d[k]).slice(0, 80)}`;
  }
  try {
    return JSON.stringify(d).slice(0, 120);
  } catch {
    return "";
  }
}
