"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Cpu,
  TrendingUp,
  RefreshCw,
  Activity,
  Play,
  Square,
  Sparkles,
  BarChart3,
  Server,
  Settings,
  Database,
  History,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { useMLMetrics } from "@/hooks/useMLMetrics";
import { useFederatedLearning } from "@/hooks/useFederatedLearning";
import { useNodes } from "@/hooks/useNodes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function MLIntelligencePage() {
  const {
    drift,
    driftHistory = [],
    model,
    stats,
    retrainStatus,
    isLoading: isMlLoading,
    triggerRetrain,
    isRetraining,
  } = useMLMetrics();

  const {
    models = [],
    isLoading: isFlLoading,
    isError: isFlError,
    startSession,
    isStarting,
    stopSession,
  } = useFederatedLearning();

  const { data: nodes = [] } = useNodes();

  const [selectedModelId, setSelectedModelId] = useState("");
  const [totalRounds, setTotalRounds] = useState(10);
  const [minClients, setMinClients] = useState(3);
  const [learningRate, setLearningRate] = useState(0.01);

  const handleStartSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModelId) {
      toast.error("Please select a model first.");
      return;
    }
    startSession(
      {
        modelId: selectedModelId,
        totalRounds,
        config: { minClients, learningRate },
      },
      {
        onSuccess: () => {
          toast.success("Federated learning session initialized!");
        },
        onError: (err: any) => {
          toast.error(err?.message || "Failed to start session.");
        },
      }
    );
  };

  const handleStopSession = (sessionId: string) => {
    stopSession(sessionId, {
      onSuccess: () => {
        toast.info("Session stopped.");
      },
    });
  };

  const activeNodesCount = nodes.filter((n) => n.status === "online").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Brain className="h-6 w-6 text-teal-400" />
            ML Intelligence & Federated Learning
          </h1>
          <p className="text-muted-foreground">
            Distributed edge optimization telemetry, model drift diagnostics, and collaborative training control.
          </p>
        </div>
        <div>
          <Button
            onClick={() => {
              triggerRetrain();
              toast.info("Global retrain signal dispatched.");
            }}
            disabled={isRetraining}
            variant="outline"
            className={`gap-2 border-teal-500/20 hover:bg-teal-500/10 text-teal-400 ${isRetraining ? "animate-pulse" : ""}`}
          >
            <RefreshCw className={`h-4 w-4 ${isRetraining ? "animate-spin" : ""}`} />
            {isRetraining ? `${retrainStatus?.status || "Training"}...` : "Trigger Global Retrain"}
          </Button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 md:grid-cols-4">
        {/* Model Drift Card */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Model Drift Index
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${drift?.isDrifting ? "text-rose-400 animate-pulse" : "text-teal-400"}`}>
              {isMlLoading ? "..." : typeof drift?.driftScore === "number" ? drift.driftScore.toFixed(3) : "No data yet"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {drift?.isDrifting
                ? "WARNING: Drift threshold (0.1) exceeded!"
                : typeof drift?.driftScore === "number"
                ? "Nominal status (below 0.1 threshold)"
                : "No live drift telemetry"}
            </p>
            <div className="mt-3 w-full bg-secondary h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${drift?.isDrifting ? "bg-rose-500" : "bg-teal-500"}`}
                style={{ width: `${Math.min((drift?.driftScore || 0) * 500, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Model Accuracy Card */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-teal-400" />
              Scheduler Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-teal-400">
              {isMlLoading ? "..." : typeof model?.accuracy === "number" ? `${(model.accuracy * 100).toFixed(1)}%` : "N/A — no data"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Target optimization accuracy over last trained model
            </p>
          </CardContent>
        </Card>

        {/* Exploration Rate */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              Exploration (Bandit)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {isMlLoading ? "..." : typeof stats?.banditExplorationRate === "number" ? `${(stats.banditExplorationRate * 100).toFixed(0)}%` : "0%"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Resource routing explore-exploit ratio
            </p>
          </CardContent>
        </Card>

        {/* Buffer Card */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-400" />
              Outcomes Buffered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-400">
              {isMlLoading ? "..." : typeof stats?.outcomesBuffered === "number" ? `${stats.outcomesBuffered} / 500` : "0 / 500"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Required points for next autonomous update
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Analytics and Config Section */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Drift Timeline */}
        <Card className="bg-card/50 backdrop-blur-sm border-border md:col-span-2">
          <CardHeader>
            <CardTitle>Historical Drift Score (24h)</CardTitle>
            <CardDescription>Continuous tracking of routing policy mismatch metrics.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {driftHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Loading telemetry stream...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={driftHistory}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
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
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
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
                      stroke="#0d9488"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Drift Score"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Start FL Session Form */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardHeader>
            <CardTitle>Orchestrate FL Session</CardTitle>
            <CardDescription>Configure and dispatch a training cycle to edge nodes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStartSession} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                  Active Model
                </label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-teal-400 focus:outline-none"
                >
                  <option value="">Select Target Model...</option>
                  {models.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.version})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                    Total Rounds
                  </label>
                  <input
                    type="number"
                    value={totalRounds}
                    onChange={(e) => setTotalRounds(parseInt(e.target.value) || 5)}
                    className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-teal-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                    Min Clients
                  </label>
                  <input
                    type="number"
                    value={minClients}
                    onChange={(e) => setMinClients(parseInt(e.target.value) || 3)}
                    className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-teal-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                  Learning Rate
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={learningRate}
                  onChange={(e) => setLearningRate(parseFloat(e.target.value) || 0.01)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-teal-400 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={isStarting || !selectedModelId || activeNodesCount < minClients}
                  className="w-full gap-2 bg-teal-500 hover:bg-teal-600 text-slate-950 font-semibold"
                >
                  <Play className="h-4 w-4" />
                  {isStarting ? "Initializing..." : "Start training session"}
                </Button>
                {activeNodesCount < minClients && (
                  <p className="text-[10px] text-rose-400 mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    Insufficient online nodes ({activeNodesCount}/{minClients} required).
                  </p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Federated Models Registry */}
      <Card className="bg-card/50 backdrop-blur-sm border-border">
        <CardHeader>
          <CardTitle>Federated Model Registry</CardTitle>
          <CardDescription>Registered neural net architectures and real-time training sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          {isFlError ? (
            <div className="text-center py-6 text-rose-400 text-sm">
              Failed to load registry. Check API connectivity and try refreshing.
            </div>
          ) : isFlLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Loading registry database...
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No registered model schemas found.
            </div>
          ) : (
            <div className="space-y-6">
              {models.map((m: any) => (
                <div key={m.id} className="border border-border/80 rounded-lg p-4 bg-secondary/20 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{m.name}</span>
                        <Badge variant="outline" className="bg-teal-500/10 text-teal-400 border-teal-500/20">
                          {m.version}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Architecture: <strong className="text-foreground">{m.architecture}</strong> | Params:{" "}
                        <strong className="text-foreground">{(m.parameters / 1_000_000).toFixed(1)}M</strong>
                      </span>
                    </div>
                    {m.weightsUrl && (
                      <a
                        href={m.weightsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-teal-400 hover:underline flex items-center gap-1.5 self-start sm:self-center"
                      >
                        <FileText className="h-3.5 w-3.5" /> Download weights (
                        {(m.weightsSize / (1024 * 1024)).toFixed(1)} MB)
                      </a>
                    )}
                  </div>

                  {/* Sessions Sublist */}
                  {m.sessions && m.sessions.length > 0 && (
                    <div className="border-t border-border/40 pt-3">
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                        <History className="h-3.5 w-3.5" /> Session Runs
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-[120px]">Session ID</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Round</TableHead>
                            <TableHead>Target Loss</TableHead>
                            <TableHead>Accuracy</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {m.sessions.map((s: any) => (
                            <TableRow key={s.id} className="hover:bg-secondary/40">
                              <TableCell className="font-mono text-xs max-w-[120px] truncate">{s.id}</TableCell>
                              <TableCell>
                                <Badge
                                  className={
                                    s.status === "RUNNING"
                                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                      : "bg-teal-500/15 text-teal-400 border-teal-500/30"
                                  }
                                  variant="outline"
                                >
                                  {s.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs">
                                    {s.currentRound} / {s.totalRounds}
                                  </span>
                                  <Progress
                                    value={(s.currentRound / s.totalRounds) * 100}
                                    className="w-16 h-1.5"
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{s.metrics?.loss?.toFixed(4) || "0.0000"}</TableCell>
                              <TableCell className="font-mono text-xs text-teal-400 font-semibold">
                                {s.metrics?.accuracy ? `${(s.metrics.accuracy * 100).toFixed(1)}%` : "N/A"}
                              </TableCell>
                              <TableCell className="text-right">
                                {s.status === "RUNNING" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleStopSession(s.id)}
                                    className="h-8 border-rose-500/20 hover:bg-rose-500/10 text-rose-400 gap-1.5"
                                  >
                                    <Square className="h-3 w-3 fill-current" /> Stop
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
