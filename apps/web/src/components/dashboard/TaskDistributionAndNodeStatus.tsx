import { useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  PieChart as PieIcon,
  BarChart3,
  Target,
  ChevronRight,
} from "lucide-react";
import type { EdgeNode, SystemMetrics } from "../../types";
import { cn } from "../../lib/utils";

interface TaskDistributionAndNodeStatusProps {
  metrics: SystemMetrics;
  nodes: EdgeNode[];
}

const SLICE_COLORS: Record<string, string> = {
  PENDING: "#6b7280",
  RUNNING: "#00d4aa",
  COMPLETED: "#10b981",
  FAILED: "#ef4444",
};

type NodeSortKey = "cpu" | "memory" | "latency" | "tasks";

export function TaskDistributionAndNodeStatus({
  metrics,
  nodes,
}: TaskDistributionAndNodeStatusProps) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<NodeSortKey>("cpu");

  const pieData = useMemo(
    () => [
      { name: "PENDING", value: metrics.pendingTasks },
      { name: "RUNNING", value: metrics.runningTasks },
      { name: "COMPLETED", value: metrics.completedTasks },
      { name: "FAILED", value: metrics.failedTasks },
    ],
    [metrics],
  );
  const totalTasks =
    metrics.pendingTasks +
    metrics.runningTasks +
    metrics.completedTasks +
    metrics.failedTasks;

  const sortedNodes = useMemo(() => {
    const copy = [...nodes];
    copy.sort((a, b) => {
      switch (sortBy) {
        case "memory":
          return b.memory - a.memory;
        case "latency":
          return b.latency - a.latency;
        case "tasks":
          return b.tasksRunning - a.tasksRunning;
        default:
          return b.cpu - a.cpu;
      }
    });
    return copy.slice(0, 8);
  }, [nodes, sortBy]);

  const barData = sortedNodes.map((n) => ({
    name: n.name.toUpperCase(),
    id: n.id,
    cpu: Math.round(n.cpu),
    memory: Math.round(n.memory),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Task Distribution */}
      <div className="card-brief p-6 flex flex-col h-[400px]">
        <div className="flex items-center gap-2 mb-6 border-b border-border/50 pb-4">
          <PieIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">
            Distribution
          </h3>
        </div>

        <div className="flex-1 relative min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={90}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={SLICE_COLORS[entry.name] ?? "#6b7280"}
                    className="hover:opacity-80 transition-opacity outline-none"
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#050508",
                  border: "1px solid #ffffff10",
                  borderRadius: "4px",
                  fontSize: 10,
                  fontFamily: "JetBrains Mono",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-3xl font-black font-mono text-foreground tracking-tighter">
              {totalTasks}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Tasks
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          {pieData.map((s) => (
            <div
              key={s.name}
              className="flex flex-col gap-1 p-2 rounded-lg bg-white/[0.02] border border-border/20"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: SLICE_COLORS[s.name] }}
                />
                <span className="text-[9px] font-bold uppercase tracking-tighter text-muted-foreground">
                  {s.name}
                </span>
              </div>
              <span className="text-sm font-bold font-mono text-foreground">
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Node Status bars */}
      <div className="lg:col-span-2 card-brief p-6 flex flex-col h-[400px]">
        <div className="flex items-center justify-between mb-6 border-b border-border/50 pb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">
              Infrastructure Load
            </h3>
          </div>
          <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg">
            {(["cpu", "memory", "latency", "tasks"] as NodeSortKey[]).map(
              (k) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  className={cn(
                    "px-2.5 py-1 text-[9px] uppercase tracking-widest font-black rounded-md transition-all",
                    sortBy === k
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {nodes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-30">
              <Target className="h-8 w-8 mb-2" />
              <p className="text-[10px] uppercase font-bold tracking-widest">
                No Node Data
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                onClick={(state: any) => {
                  const id = state?.activePayload?.[0]?.payload?.id;
                  if (id) router.push(`/nodes?node=${encodeURIComponent(id)}`);
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#ffffff08"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  stroke="#6b7280"
                  fontSize={9}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={9}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                />
                <Tooltip
                  cursor={{ fill: "#ffffff05" }}
                  contentStyle={{
                    backgroundColor: "#050508",
                    border: "1px solid #ffffff10",
                    borderRadius: "4px",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono",
                  }}
                />
                <Bar
                  dataKey="cpu"
                  name="CPU"
                  fill="#00d4aa"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="memory"
                  name="MEM"
                  fill="#6366f1"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-[#00d4aa]" />
              <span className="text-[9px] font-bold uppercase text-muted-foreground">
                CPU Utilization
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-[#6366f1]" />
              <span className="text-[9px] font-bold uppercase text-muted-foreground">
                Memory Usage
              </span>
            </div>
          </div>
          <Link
            href="/nodes"
            className="text-[9px] font-black uppercase text-primary hover:underline flex items-center gap-1"
          >
            Global Fleet <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
