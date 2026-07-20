"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  Plus,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit2,
  Search,
  Filter,
  Sliders,
  Leaf,
  DollarSign,
  Zap,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useSchedulingPolicy,
  useUpdateSchedulingPolicy,
  useGovernanceMetrics,
  useSchedulingPolicies,
  useCreateSchedulingPolicy,
} from "@/hooks/usePolicies";
import { useWebSocketChannel } from "@/lib/websocketClient";
import { useQueryClient } from "@tanstack/react-query";
import { CreatePolicyModal } from "@/components/modals/CreatePolicyModal";
import { toast } from "sonner";


export default function PoliciesPage() {
  const [search, setSearch] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch tenant-specific policy
  const { data: policy, isLoading, isError } = useSchedulingPolicy();
  const updatePolicyMutation = useUpdateSchedulingPolicy();
  const createPolicyMutation = useCreateSchedulingPolicy();

  // Fetch governance metrics and policies
  const { data: governanceMetrics } = useGovernanceMetrics();
  const { data: schedulingPolicies } = useSchedulingPolicies();

  const handleCreatePolicy = async (data: any) => {
    try {
      await createPolicyMutation.mutateAsync(data);
      toast.success(`Policy "${data.name}" created successfully`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create policy");
    }
  };


  const metrics = governanceMetrics || {
    activeConstraints: 12,
    policyViolations: 0,
    complianceScore: 0,
    totalNodes: 0,
    onlineNodes: 0,
  };

  // Local state for weights, normalized to 0-100 for sliders
  const [weights, setWeights] = useState({
    latency: 33,
    cost: 33,
    carbon: 34,
  });

  // Keep local state in sync with server data
  useEffect(() => {
    if (policy && policy.config) {
      setWeights({
        latency: Math.round((policy.config.latencyWeight ?? 0.33) * 100),
        cost: Math.round((policy.config.costWeight ?? 0.33) * 100),
        carbon: Math.round((policy.config.carbonWeight ?? 0.34) * 100),
      });
    }
  }, [policy]);

  // Real-time WebSocket updates to sync and invalidate
  useWebSocketChannel("scheduler", (event: any) => {
    if (event?.type === "scheduler.policy_updated") {
      console.log("[WebSocket] Policy updated event received:", event);
      void queryClient.invalidateQueries({ queryKey: ["scheduling-policy"] });
      void queryClient.invalidateQueries({ queryKey: ["scheduling-policies"] });
      void queryClient.invalidateQueries({ queryKey: ["governance-metrics"] });
    }
  });

  // Proportional weight adjustment handler
  const handleWeightChange = (key: "latency" | "cost" | "carbon", val: number) => {
    const newVal = Math.min(100, Math.max(0, val));
    if (newVal === 100) {
      setWeights({
        latency: key === "latency" ? 100 : 0,
        cost: key === "cost" ? 100 : 0,
        carbon: key === "carbon" ? 100 : 0,
      });
      return;
    }

    const remaining = 100 - newVal;
    const otherKeys = (["latency", "cost", "carbon"] as const).filter((k) => k !== key);
    const sumOthers = weights[otherKeys[0]] + weights[otherKeys[1]];

    let newOthers;
    if (sumOthers === 0) {
      // Distribute remaining equally
      newOthers = {
        [otherKeys[0]]: Math.floor(remaining / 2),
        [otherKeys[1]]: Math.ceil(remaining / 2),
      };
    } else {
      // Distribute remaining proportionally
      const share1 = Math.round((weights[otherKeys[0]] / sumOthers) * remaining);
      const share2 = remaining - share1;
      newOthers = {
        [otherKeys[0]]: share1,
        [otherKeys[1]]: share2,
      };
    }

    setWeights({
      latency: key === "latency" ? newVal : (newOthers.latency ?? weights.latency),
      cost: key === "cost" ? newVal : (newOthers.cost ?? weights.cost),
      carbon: key === "carbon" ? newVal : (newOthers.carbon ?? weights.carbon),
    });
  };

  const handleSavePolicy = () => {
    // Convert back to 0.0 - 1.0 format
    const payload = {
      latencyWeight: weights.latency / 100,
      costWeight: weights.cost / 100,
      carbonWeight: weights.carbon / 100,
    };
    updatePolicyMutation.mutate(payload);
  };

  const filteredPolicies = (schedulingPolicies || []).filter((p) => {
    if (!search) return true;
    const cleanName = p.name.replace(/ - [a-f0-9-]+$/, "");
    return (
      cleanName.toLowerCase().includes(search.toLowerCase()) ||
      p.type.toLowerCase().includes(search.toLowerCase())
    );
  });


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Governance & Scheduling Policies
          </h1>
          <p className="text-muted-foreground">
            Tune scheduler objectives and manage fleet-wide workload placement constraints.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="h-4 w-4" /> Create Policy
        </Button>
      </div>

      {/* Dynamic Tunable Scheduling Policy Slider Block */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 bg-card/40 border-border backdrop-blur-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] text-emerald-400 font-medium">Live Policy Sync</span>
          </div>

          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-teal-400" />
              Multi-Objective Tunable Scheduler
            </CardTitle>
            <CardDescription>
              Adjust weights dynamically. The scheduling engine updates candidate scoring tradeoffs in real-time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading scheduling policy...</span>
              </div>
            ) : isError ? (
              <div className="flex items-center gap-2 p-4 border border-rose-500/20 bg-rose-500/10 rounded-lg text-rose-200">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Failed to retrieve scheduling policy. Please try again.</span>
              </div>
            ) : (
              <>
                {/* Visual Ratio Stack Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground font-medium px-1">
                    <span>Tradeoff Distribution</span>
                    <span>Total: {weights.latency + weights.cost + weights.carbon}%</span>
                  </div>
                  <div className="h-4 w-full rounded-full bg-muted overflow-hidden flex">
                    <div
                      style={{ width: `${weights.latency}%` }}
                      className="bg-gradient-to-r from-sky-500 to-cyan-400 h-full transition-all duration-300"
                    />
                    <div
                      style={{ width: `${weights.cost}%` }}
                      className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full transition-all duration-300"
                    />
                    <div
                      style={{ width: `${weights.carbon}%` }}
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                    />
                  </div>
                </div>

                {/* Sliders Container */}
                <div className="grid gap-6 sm:grid-cols-3">
                  {/* Latency Slider */}
                  <div className="space-y-3 p-4 rounded-lg bg-black/20 border border-border/40">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-1.5 text-cyan-400">
                        <Zap className="h-4 w-4" /> Latency
                      </span>
                      <span className="text-sm font-bold font-mono">{weights.latency}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={weights.latency}
                      onChange={(e) => handleWeightChange("latency", parseInt(e.target.value))}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Prioritizes nodes closer to tasks, reducing execution delay.
                    </p>
                  </div>

                  {/* Cost Slider */}
                  <div className="space-y-3 p-4 rounded-lg bg-black/20 border border-border/40">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-1.5 text-yellow-400">
                        <DollarSign className="h-4 w-4" /> Cost Efficiency
                      </span>
                      <span className="text-sm font-bold font-mono">{weights.cost}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={weights.cost}
                      onChange={(e) => handleWeightChange("cost", parseInt(e.target.value))}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-yellow-400 focus:outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Routes tasks to cheaper resources or low-cost regional instances.
                    </p>
                  </div>

                  {/* Carbon Slider */}
                  <div className="space-y-3 p-4 rounded-lg bg-black/20 border border-border/40">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-1.5 text-emerald-400">
                        <Leaf className="h-4 w-4" /> Carbon Minimization
                      </span>
                      <span className="text-sm font-bold font-mono">{weights.carbon}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={weights.carbon}
                      onChange={(e) => handleWeightChange("carbon", parseInt(e.target.value))}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-400 focus:outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Selects nodes powered by clean grids with low carbon intensity.
                    </p>
                  </div>
                </div>

                {/* Save Block */}
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground">
                    Active policy: <span className="font-mono font-medium text-teal-400">{policy?.id ?? "pol-default"}</span>
                  </div>
                  <Button
                    onClick={handleSavePolicy}
                    disabled={updatePolicyMutation.isPending}
                    className="gap-2 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 border-0 text-white font-medium"
                  >
                    {updatePolicyMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" /> Saving...
                      </>
                    ) : (
                      "Apply Scheduling Weights"
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Governance Metrics Sidebar */}
        <div className="space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Active Constraints
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.activeConstraints}</div>
              <p className="text-xs text-muted-foreground mt-1">Applying to {metrics.totalNodes} edge nodes</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400" /> Policy Violations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.policyViolations}</div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                {metrics.policyViolations > 0 ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    <span>Anomalies detected across fleet</span>
                  </>
                ) : (
                  <span>All nodes operating within margins</span>
                )}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-teal-400" /> Compliance Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-teal-400">{metrics.complianceScore}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.complianceScore === 100 && metrics.totalNodes > 0 && metrics.onlineNodes === metrics.totalNodes
                  ? "Optimal system alignment"
                  : metrics.totalNodes > 0
                  ? `${metrics.onlineNodes}/${metrics.totalNodes} nodes online`
                  : "No nodes registered"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Policy Inventory table */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Policy Inventory</CardTitle>
              <CardDescription>Browse and configure individual fleet constraints.</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter policies..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead>Policy Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPolicies.map((policyItem) => {
                let targetDisplay = "N/A";
                if (policyItem.type === "TUNABLE") {
                  targetDisplay = `L: ${weights.latency}% | C: ${weights.cost}% | CO2: ${weights.carbon}%`;
                } else if (policyItem.type === "LATENCY") {
                  targetDisplay = `< ${policyItem.config?.maxLatencyMs ?? 150}ms`;
                } else if (policyItem.type === "CARBON") {
                  targetDisplay = `> ${policyItem.config?.minGreenPercent ?? 80}% clean`;
                } else if (policyItem.type === "COST") {
                  targetDisplay = `< $${policyItem.config?.maxCostUSD ?? 0.05}/hr`;
                }

                const statusDisplay = policyItem.isActive ? "active" : "inactive";
                const nodesImpacted = policyItem.isActive ? metrics.totalNodes : 0;
                const displayName = policyItem.name.replace(/ - [a-f0-9-]+$/, "");

                return (
                  <TableRow key={policyItem.id} className="border-border/50 group">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {policyItem.id}
                        </span>
                        <span className="font-medium">{displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {policyItem.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-teal-400">{targetDisplay}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            statusDisplay === "active"
                              ? "bg-emerald-400"
                              : "bg-muted-foreground/30"
                          }`}
                        />
                        <span className="capitalize text-sm">{statusDisplay}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{nodesImpacted} nodes</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreatePolicyModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreatePolicy}
      />
    </div>
  );
}
