"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Cpu,
  Database,
  Zap,
  Globe,
  ShieldAlert,
  Leaf,
  History,
  Workflow,
  Search,
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
  Lock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isApiClientError } from "@edgecloud/api-client";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { WorldMap } from "@/components/charts/WorldMap";
import { useSystemMetrics } from "@/hooks/useMetrics";
import { useNodes } from "@/hooks/useNodes";
import { useMLMetrics } from "@/hooks/useMLMetrics";
import { useCarbonMetrics } from "@/hooks/useCarbonMetrics";
import {
  useCircuitBreakers,
  CircuitBreakerState,
} from "@/hooks/useCircuitBreakers";

// TODO: replace MOCK_TRACES with real trace API once available
const MOCK_TRACES = [
  {
    id: "tr-4501",
    op: "POST /v4/tasks",
    service: "gateway",
    status: "success",
    time: "12ms",
  },
  {
    id: "tr-4502",
    op: "GET /v2/nodes",
    service: "node-mgr",
    status: "success",
    time: "8ms",
  },
  {
    id: "tr-4503",
    op: "PUT /v1/scheduler",
    service: "scheduler",
    status: "error",
    time: "145ms",
  },
  {
    id: "tr-4504",
    op: "POST /v4/tasks/execute",
    service: "agent-x2",
    status: "success",
    time: "12ms",
  },
];

// Optimized Tabs from shadcn
const MonitoringTabsList = TabsList;
const MonitoringTabsTrigger = TabsTrigger;

export default function MonitoringPage() {
  const router = useRouter();
  const { data: metrics, error: metricsError } = useSystemMetrics();
  const { data: nodes = [], error: nodesError } = useNodes();
  const [searchQuery, setSearchQuery] = useState("");
  const {
    drift,
    driftHistory,
    model,
    stats,
    retrainStatus,
    isLoading: isMlLoading,
    triggerRetrain,
    isRetraining,
  } = useMLMetrics();

  const {
    regions,
    savings,
    policy,
    isLoading: isCarbonLoading,
    carbonWeight,
    setCarbonWeight,
    isUpdating: isPolicyUpdating,
  } = useCarbonMetrics();

  const {
    data: circuitBreakers = [],
    isLoading: isResilienceLoading,
    resetBreaker,
    isResetting,
  } = useCircuitBreakers();

  const [resetConfirmOpen, setResetConfirmOpen] = useState<{
    open: boolean;
    name: string;
  }>({ open: false, name: "" });

  const filteredBreakers = useMemo(() => {
    if (!searchQuery) {return circuitBreakers;}
    const lower = searchQuery.toLowerCase();
    return circuitBreakers.filter((b) => b.name.toLowerCase().includes(lower));
  }, [circuitBreakers, searchQuery]);

  const filteredTraces = useMemo(() => {
    if (!searchQuery) {return MOCK_TRACES;}
    const lower = searchQuery.toLowerCase();
    return MOCK_TRACES.filter(
      (t) =>
        t.id.toLowerCase().includes(lower) ||
        t.op.toLowerCase().includes(lower) ||
        t.service.toLowerCase().includes(lower)
    );
  }, [searchQuery]);

  const handleDownload = () => {
    try {
      const dataStr = JSON.stringify(
        { metrics, nodes, circuitBreakers, drift, stats },
        null,
        2
      );
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `monitoring-export-${new Date().toISOString()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Monitoring data exported successfully");
    } catch (e) {
      toast.error("Failed to export monitoring data");
    }
  };

  useEffect(() => {
    const error = metricsError || nodesError;
    if (error) {
      if (isApiClientError(error)) {
        if (error.isUnauthorized()) {
          router.push("/login");
          return;
        }
        toast.error(error.response.message);
      } else {
        toast.error("Failed to load monitoring data");
      }
    }
  }, [metricsError, nodesError, router]);

  return (
    <div className="space-y-6">
      {/* ... existing header ... */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            System Monitoring
          </h1>
          <p className="text-muted-foreground">
            Real-time telemetry and deep observability
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search traces or nodes..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={handleDownload} title="Download Report">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="infra" className="w-full">
        {/* ... existing tabs list ... */}
        <MonitoringTabsList className="grid w-full grid-cols-5 mb-8">
          <MonitoringTabsTrigger value="infra" className="gap-2">
            <Cpu className="h-4 w-4" /> Infrastructure
          </MonitoringTabsTrigger>
          <MonitoringTabsTrigger value="ml" className="gap-2">
            <Workflow className="h-4 w-4" /> ML Intelligence
          </MonitoringTabsTrigger>
          <MonitoringTabsTrigger value="carbon" className="gap-2">
            <Leaf className="h-4 w-4" /> Carbon & Cost
          </MonitoringTabsTrigger>
          <MonitoringTabsTrigger value="resilience" className="gap-2">
            <Zap className="h-4 w-4" /> Circuit Breakers
          </MonitoringTabsTrigger>
          <MonitoringTabsTrigger value="traces" className="gap-2">
            <History className="h-4 w-4" /> OTel Traces
          </MonitoringTabsTrigger>
        </MonitoringTabsList>

        <TabsContent value="infra" className="space-y-6">
          {/* ... existing infra content ... */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricSummaryCard
              title="Global CPU"
              value={`${(metrics?.edgeUtilization || 0).toFixed(1)}%`}
              change="-2.4%"
              trend="down"
            />
            <MetricSummaryCard
              title="Active Nodes"
              value={nodes.filter((n) => n.status === "online").length}
              change="+12"
              trend="up"
            />
            <MetricSummaryCard
              title="Total Tasks"
              value={metrics?.totalTasks || 0}
              change="+1.2k"
              trend="up"
            />
            <MetricSummaryCard
              title="Avg Latency"
              value={`${Math.round(metrics?.avgLatency || 0)}ms`}
              change="-15ms"
              trend="down"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-card/50 backdrop-blur-sm border-border">
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Resource Utilization (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics?.cpuHistory || []}>
                      <defs>
                        <linearGradient
                          id="colorCpu"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="hsl(var(--primary))"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="hsl(var(--primary))"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="hsl(var(--border))"
                      />
                      <XAxis dataKey="timestamp" hide />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                        }}
                        itemStyle={{ color: "hsl(var(--primary))" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="hsl(var(--primary))"
                        fillOpacity={1}
                        fill="url(#colorCpu)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border">
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Regional Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={regions}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="hsl(var(--border))"
                      />
                      <XAxis
                        dataKey="zone"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                        }}
                      />
                      <Bar dataKey="carbonIntensityGco2" radius={[4, 4, 0, 0]}>
                        {regions.map((entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              entry.carbonIntensityGco2 < 250
                                ? "#10b981"
                                : entry.carbonIntensityGco2 < 450
                                  ? "#f59e0b"
                                  : "#ef4444"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ml" className="space-y-6">
          {/* ... existing ml content ... */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Model Drift Index</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${drift?.isDrifting ? "text-rose-400" : "text-teal-400"}`}
                >
                  {isMlLoading
                    ? "..."
                    : drift?.driftScore?.toFixed(3) || "0.000"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {drift?.isDrifting
                    ? "DRFT DETECTED: Threshold exceeded"
                    : "Within acceptable threshold (<0.1)"}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Model Accuracy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-teal-400">
                  {isMlLoading
                    ? "..."
                    : `${((model?.accuracy || 0.94) * 100).toFixed(1)}%`}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on last 500 outcomes
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Registry Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="bg-teal-500/10 text-teal-400 border-teal-500/20"
                    >
                      {model?.version || "v2.4.0"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {model?.modelType || "XGBoost"}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground opacity-70">
                    Updated:{" "}
                    {model?.lastUpdatedAt
                      ? new Date(model.lastUpdatedAt).toLocaleTimeString()
                      : "N/A"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground uppercase">
                  Exploration Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {(stats?.banditExplorationRate || 0.1) * 100}%
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground uppercase">
                  Outcomes Buffered
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {stats?.outcomesBuffered || 0}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground uppercase">
                  Inference P99
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {stats?.predictionErrorP99Ms || 45}ms
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground uppercase">
                  Next Training
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {stats?.nextUpdateAt || 500} pts
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                triggerRetrain();
                toast.info("Retraining workflow initiated");
              }}
              disabled={isRetraining}
              variant="outline"
              className={`gap-2 border-teal-500/20 hover:bg-teal-500/10 text-teal-400 ${isRetraining ? "animate-pulse" : ""}`}
            >
              {isRetraining ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {isRetraining
                ? `${retrainStatus?.status || "Processing"}...`
                : "Trigger Manual Retrain"}
            </Button>
          </div>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle>Optimizer Accuracy vs. Drift</CardTitle>
              <CardDescription>
                24-hour analysis of ML scheduler performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={driftHistory || []}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="timestamp"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) =>
                        new Date(val).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      }
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                      }}
                      labelFormatter={(val) => new Date(val).toLocaleString()}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#00d4aa"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      name="Drift Score"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="carbon" className="space-y-6">
          {/* ... existing carbon content ... */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-card/50 border-border">
              <CardHeader>
                <CardTitle>Regional Carbon Intensity</CardTitle>
                <CardDescription>
                  gCO2eq/kWh per operational region
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={regions} layout="vertical">
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={false}
                        stroke="hsl(var(--border))"
                      />
                      <XAxis
                        type="number"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                      />
                      <YAxis
                        dataKey="zone"
                        type="category"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                        }}
                      />
                      <Bar
                        dataKey="carbonIntensityGco2"
                        radius={[0, 4, 4, 0]}
                        name="gCO2eq/kWh"
                      >
                        {regions.map((entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              entry.carbonIntensityGco2 < 200
                                ? "#10b981"
                                : entry.carbonIntensityGco2 < 400
                                  ? "#f59e0b"
                                  : "#ef4444"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border lg:col-span-2 overflow-hidden">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  Live Eco-Overlay
                </CardTitle>
                <CardDescription>
                  Real-time grid intensity visualization across the global fleet
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 h-[400px]">
                <WorldMap
                  nodes={nodes}
                  carbonMode={true}
                  className="border-none rounded-none"
                />
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border">
              <CardHeader>
                <CardTitle>Operational Savings</CardTitle>
                <CardDescription>
                  Calculated from eco-aware scheduling decisions
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center pt-8">
                <div className="text-5xl font-bold text-teal-400">
                  {isCarbonLoading
                    ? "..."
                    : ((savings?.totalSavedGco2Today || 0) / 1000).toFixed(1)}
                  kg
                </div>
                <div className="text-sm text-muted-foreground mt-2">
                  Carbon Avoided Today
                </div>
                <div className="mt-8 grid grid-cols-2 gap-8 w-full">
                  <div className="text-center">
                    <div className="text-xl font-semibold">
                      {isCarbonLoading
                        ? "..."
                        : ((savings?.totalSavedGco2Week || 0) / 1000).toFixed(
                            1,
                          )}
                      kg
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Total This Week
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-semibold flex items-center justify-center gap-1">
                      <Leaf className="h-4 w-4 text-emerald-400" />
                      {savings?.equivalentTreesPlanted || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Equiv. Trees Planted
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Optimization Policy
                  {isPolicyUpdating && (
                    <Activity className="h-4 w-4 animate-spin text-teal-400" />
                  )}
                </CardTitle>
                <CardDescription>
                  Adjust how much weight is given to carbon footprint vs
                  performance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">
                      Carbon Weighting Factor
                    </span>
                    <Badge
                      variant="outline"
                      className="bg-teal-500/10 text-teal-400 border-teal-500/20"
                    >
                      {Math.round(carbonWeight * 100)}%
                    </Badge>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={carbonWeight}
                    onChange={(e) =>
                      setCarbonWeight(parseFloat(e.target.value))
                    }
                    className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-teal-400"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>PERFORMANCE FIRST</span>
                    <span>BALANCED</span>
                    <span>ECO FIRST</span>
                  </div>
                </div>
                <div className="p-3 rounded-md bg-teal-500/5 border border-teal-500/10 text-xs">
                  <p className="font-medium text-teal-400 mb-1">
                    Active Strategy: {policy?.activePolicy || "Eco-Optimizer"}
                  </p>
                  <p className="text-muted-foreground opacity-80">
                    Currently prioritizing regions with intensity &lt; 250
                    gCO2/kWh when possible.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border">
              <CardHeader>
                <CardTitle>Savings History (7d)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={savings?.savingsHistory || []}>
                      <defs>
                        <linearGradient
                          id="colorSavings"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10b981"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10b981"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="hsl(var(--border))"
                      />
                      <XAxis dataKey="date" hide />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                        }}
                        labelFormatter={(val) =>
                          new Date(val).toLocaleDateString()
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="savedGco2"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorSavings)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="resilience" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Circuit Breaker Registry</h3>
              <p className="text-sm text-muted-foreground">
                Active protection for system-wide dependencies
              </p>
            </div>
            {isResilienceLoading && (
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            )}
          </div>

          <div className="grid gap-4">
            {filteredBreakers.length === 0 && !isResilienceLoading && (
              <div className="py-12 text-center border border-dashed rounded-lg">
                <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-muted-foreground">
                  No active circuit breakers detected
                </p>
              </div>
            )}

            {filteredBreakers.map((breaker) => (
              <CircuitBreakerCard
                key={breaker.name}
                breaker={breaker}
                onReset={() =>
                  setResetConfirmOpen({ open: true, name: breaker.name })
                }
              />
            ))}
          </div>

          {/* Reset Confirmation Modal */}
          {resetConfirmOpen.open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-card border border-border p-6 rounded-xl max-w-md w-full shadow-2xl"
              >
                <div className="flex items-center gap-3 text-rose-400 mb-4">
                  <ShieldAlert className="h-6 w-6" />
                  <h3 className="text-xl font-bold">Confirm Override</h3>
                </div>
                <p className="text-muted-foreground mb-6">
                  Force closing the{" "}
                  <span className="font-mono text-foreground font-bold">
                    {resetConfirmOpen.name}
                  </span>{" "}
                  circuit breaker while the service is unreachable will cause
                  cascading failures. Are you sure?
                </p>
                <div className="flex gap-3 justify-end">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setResetConfirmOpen({ open: false, name: "" })
                    }
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="bg-rose-600 hover:bg-rose-700"
                    onClick={() => {
                      resetBreaker(resetConfirmOpen.name);
                      setResetConfirmOpen({ open: false, name: "" });
                    }}
                    disabled={isResetting}
                  >
                    {isResetting ? "Processing..." : "Confirm Force Close"}
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="traces" className="space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle>Distributed Trace Explorer</CardTitle>
              <CardDescription>
                OTel-instrumented request flows across the fleet
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {filteredTraces.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground border border-dashed rounded-lg">
                    No traces match your search.
                  </div>
                ) : (
                  filteredTraces.map((trace) => (
                    <div
                      key={trace.id}
                      className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-background/30 hover:bg-background/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <History className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="font-mono text-xs text-teal-400 mr-2">
                            {trace.id}
                          </span>
                          <span className="text-sm font-medium">{trace.op}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase"
                        >
                          {trace.service}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {trace.time}
                        </span>
                        {trace.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-rose-400" />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <Button variant="link" className="w-full mt-4 text-teal-400">
                View in Jaeger →
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricSummaryCard({
  title,
  value,
  change,
  trend,
}: {
  title: string;
  value: string | number;
  change: string;
  trend: "up" | "down";
}) {
  return (
    <Card className="bg-card/50 border-border overflow-hidden">
      <CardContent className="p-6">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="flex items-end justify-between mt-1">
          <div className="text-2xl font-bold">{value}</div>
          <div
            className={`text-xs flex items-center ${trend === "up" ? "text-emerald-400" : "text-rose-400"}`}
          >
            {trend === "up" ? "↑" : "↓"} {change}
          </div>
        </div>
      </CardContent>
      <div
        className={`h-1 w-full ${trend === "up" ? "bg-emerald-500/20" : "bg-rose-500/20"}`}
      >
        <div
          className={`h-full w-2/3 ${trend === "up" ? "bg-emerald-500" : "bg-rose-500"}`}
        />
      </div>
    </Card>
  );
}

function CircuitBreakerCard({
  breaker,
  onReset,
}: {
  breaker: CircuitBreakerState;
  onReset: () => void;
}) {
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const prevState = useRef(breaker.state);
  const [flash, setFlash] = useState<"none" | "rose" | "emerald">("none");

  useEffect(() => {
    if (breaker.state !== prevState.current) {
      if (breaker.state === "OPEN") {setFlash("rose");}
      else if (breaker.state === "CLOSED") {setFlash("emerald");}

      const timer = setTimeout(() => setFlash("none"), 1500);
      prevState.current = breaker.state;
      return () => clearTimeout(timer);
    }
  }, [breaker.state]);

  const statusColor = useMemo(() => {
    switch (breaker.state) {
      case "CLOSED":
        return "emerald";
      case "OPEN":
        return "rose";
      case "HALF_OPEN":
        return "amber";
      default:
        return "muted";
    }
  }, [breaker.state]);

  const Icon = useMemo(() => {
    switch (breaker.name.toLowerCase()) {
      case "postgresql":
      case "database":
        return Database;
      case "redis":
        return Zap;
      case "vaultpki":
        return Lock;
      case "external-api":
        return Globe;
      default:
        return Server;
    }
  }, [breaker.name]);

  // Countdown timer for next retry
  useEffect(() => {
    if (breaker.state !== "OPEN" || !breaker.nextRetryAt) {
      setTimeLeft(null);
      return;
    }

    const interval = setInterval(() => {
      const next = new Date(breaker.nextRetryAt!).getTime();
      const now = new Date().getTime();
      const diff = next - now;

      if (diff <= 0) {
        setTimeLeft("Imminent...");
      } else {
        const seconds = Math.floor(diff / 1000);
        setTimeLeft(`${seconds}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [breaker.state, breaker.nextRetryAt]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        backgroundColor:
          flash === "rose"
            ? "rgba(244, 63, 94, 0.15)"
            : flash === "emerald"
              ? "rgba(16, 185, 129, 0.15)"
              : undefined,
      }}
      transition={{ duration: 0.3 }}
      className={`group relative overflow-hidden rounded-xl border transition-all hover:shadow-lg ${
        breaker.state === "OPEN"
          ? "border-rose-500/30 bg-rose-500/5 shadow-rose-500/5"
          : "border-border bg-card/50"
      }`}
    >
      <CardContent className="flex flex-col md:flex-row items-center justify-between p-6 gap-6">
        <div className="flex items-center gap-5 w-full md:w-auto">
          <div
            className={`p-3 rounded-xl transition-colors ${
              statusColor === "emerald"
                ? "bg-emerald-500/10 text-emerald-400"
                : statusColor === "rose"
                  ? "bg-rose-500/10 text-rose-400 animate-pulse"
                  : "bg-amber-500/10 text-amber-400"
            }`}
          >
            <Icon className="h-6 w-6" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-lg">{breaker.name}</h4>
              <Badge
                variant="outline"
                className={`text-[10px] uppercase font-bold tracking-wider ${
                  statusColor === "emerald"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : statusColor === "rose"
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}
              >
                {breaker.state.replace("_", " ")}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(breaker.lastStateChange), {
                  addSuffix: true,
                })}
              </span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
              <span>
                Failure Rate:{" "}
                <span
                  className={breaker.failureRate > 0 ? "text-rose-400" : ""}
                >
                  {breaker.failureRate.toFixed(1)}%
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
          <div className="grid grid-cols-2 gap-6 text-center">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground font-semibold tracking-tighter">
                Success
              </div>
              <div className="text-lg font-bold text-emerald-400/80">
                {breaker.successCount}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground font-semibold tracking-tighter">
                Failure
              </div>
              <div className="text-lg font-bold text-rose-400/80">
                {breaker.failureCount}
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {breaker.state === "OPEN" ? (
              <motion.div
                key="retry"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col items-center justify-center bg-rose-500/10 px-4 py-2 rounded-lg border border-rose-500/20"
              >
                <span className="text-[10px] font-bold uppercase text-rose-400 leading-none mb-1">
                  Retry In
                </span>
                <span className="text-xl font-mono font-bold text-rose-400 tabular-nums">
                  {timeLeft || "--"}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="actions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-2"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs hover:bg-rose-500/10 hover:text-rose-400"
                  onClick={onReset}
                >
                  <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                  Override
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>

      {/* Visual progress bar for health */}
      <div className="absolute bottom-0 left-0 h-0.5 w-full bg-muted/20">
        <motion.div
          className={`h-full ${statusColor === "emerald" ? "bg-emerald-500" : statusColor === "rose" ? "bg-rose-500" : "bg-amber-500"}`}
          initial={{ width: "100%" }}
          animate={{ width: `${100 - breaker.failureRate}%` }}
          transition={{ duration: 1 }}
        />
      </div>
    </motion.div>
  );
}
