import { useRouter } from "next/navigation";
import {
  Server,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  ShieldCheck,
  Target,
} from "lucide-react";
import CountUp from "react-countup";
import { HealthScoreGauge } from "../charts/HealthScoreGauge";
import { formatCurrency, cn } from "../../lib/utils";
import { useWsEventStream } from "../../stores/websocket";
import type { SystemMetrics } from "../../types";
import { motion } from "framer-motion";

interface StatCardsProps {
  metrics: SystemMetrics;
  mlActive?: boolean;
  onOpenHealthBreakdown?: () => void;
}

export function StatCards({ metrics, onOpenHealthBreakdown }: StatCardsProps) {
  const router = useRouter();

  const uptimePct = Math.round(
    (metrics.onlineNodes / Math.max(1, metrics.totalNodes)) * 100,
  );

  const schedEvents = useWsEventStream("scheduler.");
  const latencySeries = schedEvents
    .slice(-20)
    .map((e) =>
      Number((e.data as any)?.latencyMs ?? (e.data as any)?.latency ?? 0),
    )
    .filter((n) => Number.isFinite(n) && n > 0);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <StatCard
        title="Edge Infrastructure"
        value={metrics.onlineNodes}
        subtitle={`${metrics.totalNodes} Provisioned`}
        trend={+2.4}
        icon={Server}
        color="teal"
        onClick={() => router.push("/nodes?status=online")}
      >
        <div className="flex items-center gap-2 mt-2">
          <div className="flex -space-x-1.5">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-4 w-4 rounded-full border border-card bg-primary/20"
              />
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            {uptimePct}% Uptime
          </span>
        </div>
      </StatCard>

      <StatCard
        title="Completed Sagas"
        value={metrics.completedTasks}
        subtitle={`${metrics.runningTasks} In-Flight`}
        trend={+12.8}
        icon={ShieldCheck}
        color="indigo"
        onClick={() => router.push("/scheduler")}
      >
        <div className="flex items-center gap-1.5 mt-2">
          <Zap className="h-3 w-3 text-primary animate-pulse" />
          <span className="text-[10px] text-primary font-bold font-mono">
            1.2k req/sec
          </span>
        </div>
      </StatCard>

      <StatCard
        title="Execution Latency"
        value={`${Math.round(metrics.avgLatency)}ms`}
        subtitle="p99 Global"
        trend={-4.2}
        icon={Activity}
        color="amber"
      >
        <div className="mt-2 h-6 overflow-hidden">
          {latencySeries.length > 1 && (
            <Sparkline values={latencySeries} color="hsl(var(--warning))" />
          )}
        </div>
      </StatCard>

      <StatCard
        title="Resource Cost"
        value={formatCurrency(metrics.totalCost)}
        subtitle="Current Cycle"
        trend={-0.8}
        icon={Target}
        color="emerald"
      >
        <div className="flex items-center gap-2 mt-2">
          <div className="h-1 flex-1 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 w-[65%]" />
          </div>
          <span className="text-[9px] text-muted-foreground">65% Budg.</span>
        </div>
      </StatCard>

      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={onOpenHealthBreakdown}
        className="card-brief p-4 flex flex-col justify-between text-left transition-all hover:border-primary/50 relative overflow-hidden group"
      >
        <div
          className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity"
          aria-hidden="true"
        >
          <Activity className="h-24 w-24 -mr-8 -mt-8" />
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            System Integrity
          </span>
          <HealthScoreGauge score={metrics.healthScore} size={40} />
        </div>
        <div>
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {metrics.healthScore >= 80 ? "NOMINAL" : "DEGRADED"}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                metrics.healthScore >= 80 ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            <span className="text-[10px] text-muted-foreground uppercase font-mono">
              Score: {metrics.healthScore}/100
            </span>
          </div>
        </div>
      </motion.button>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  color,
  onClick,
  children,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  trend?: number;
  icon: any;
  color: "teal" | "indigo" | "amber" | "emerald";
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const colors = {
    teal: "text-primary bg-primary/10 border-primary/20 group-hover:border-primary/50",
    indigo:
      "text-indigo-400 bg-indigo-500/10 border-indigo-500/20 group-hover:border-indigo-500/50",
    amber:
      "text-amber-400 bg-amber-500/10 border-amber-500/20 group-hover:border-amber-500/50",
    emerald:
      "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 group-hover:border-emerald-500/50",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group text-left card-brief p-5 transition-all flex flex-col justify-between relative overflow-hidden",
        !onClick && "cursor-default",
      )}
    >
      <div className="space-y-1 relative z-10">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {title}
          </p>
          <div className={cn("p-2 rounded-lg transition-all", colors[color])}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {typeof value === "number" ? (
              <CountUp
                end={value}
                duration={2}
                separator=","
                decimals={value % 1 !== 0 ? 1 : 0}
              />
            ) : (
              value
            )}
          </p>
          {trend !== undefined && (
            <div
              className={cn(
                "flex items-center gap-0.5 text-[10px] font-bold",
                trend >= 0 ? "text-emerald-500" : "text-destructive",
              )}
            >
              {trend >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {Math.abs(trend)}%
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
          {subtitle}
        </p>
      </div>
      {children}
    </motion.button>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 200;
  const h = 24;
  const step = w / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * step,
    y: h - ((v - min) / range) * h,
  }));

  const p0 = points[0];
  if (!p0) return null;
  const last = points[points.length - 1];
  if (!last) return null;

  const pathData =
    `M ${p0.x} ${p0.y} ` +
    points
      .slice(1)
      .map((p) => `L ${p.x} ${p.y}`)
      .join(" ");

  const areaData = `${pathData} L ${last.x} ${h} L ${p0.x} ${h} Z`;

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="opacity-50"
    >
      <defs>
        <linearGradient id="gradient-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaData} fill="url(#gradient-spark)" />
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
