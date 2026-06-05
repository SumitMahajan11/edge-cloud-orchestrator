"use client";

import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Filter,
  Info,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAcknowledgeAlert, useAlerts } from "@/hooks/useAlerts";

export default function AlertsPage() {
  const { data: alerts, isLoading } = useAlerts();
  const acknowledgeMutation = useAcknowledgeAlert();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  >("ALL");

  const handleAcknowledge = async (id: string) => {
    try {
      await acknowledgeMutation.mutateAsync(id);
      toast.success("Alert acknowledged");
    } catch (err) {
      toast.error("Failed to acknowledge alert");
    }
  };

  const filteredAlerts =
    alerts?.filter((alert) => {
      const matchesSearch =
        alert.title.toLowerCase().includes(search.toLowerCase()) ||
        alert.description.toLowerCase().includes(search.toLowerCase()) ||
        alert.source.toLowerCase().includes(search.toLowerCase());

      const matchesFilter = filter === "ALL" || alert.severity === filter;

      return matchesSearch && matchesFilter;
    }) || [];

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const severityConfig = {
    CRITICAL: {
      color: "bg-red-500/10 text-red-500 border-red-500/20",
      icon: <ShieldAlert className="h-4 w-4" />,
      label: "Critical",
    },
    HIGH: {
      color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
      icon: <AlertCircle className="h-4 w-4" />,
      label: "High",
    },
    MEDIUM: {
      color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Medium",
    },
    LOW: {
      color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      icon: <Info className="h-4 w-4" />,
      label: "Low",
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Alerts</h1>
          <p className="text-muted-foreground">
            Monitor and manage real-time infrastructure alerts and ML drift
            triggers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search alerts..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-card p-1">
            {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map(
              (f) => (
                <Button
                  key={f}
                  variant={filter === f ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setFilter(f)}
                >
                  {f}
                </Button>
              ),
            )}
          </div>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Active Alerts</CardTitle>
          <CardDescription>
            {filteredAlerts.length} total alerts found matching current filters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/50 overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[120px]">Severity</TableHead>
                  <TableHead>Alert Details</TableHead>
                  <TableHead className="w-[150px]">Source</TableHead>
                  <TableHead className="w-[180px]">Fired At</TableHead>
                  <TableHead className="w-[120px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-32 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
                        <p>No active alerts matching your criteria.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAlerts.map((alert) => (
                    <TableRow
                      key={alert.id}
                      className="group hover:bg-muted/30"
                    >
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`flex w-fit items-center gap-1.5 px-2 py-0.5 font-medium ${severityConfig[alert.severity].color}`}
                        >
                          {severityConfig[alert.severity].icon}
                          {severityConfig[alert.severity].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold">{alert.title}</span>
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {alert.description}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {alert.source}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(alert.firedAt), "MMM d, HH:mm:ss")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {alert.acknowledgedAt ? (
                          <div className="flex items-center justify-end gap-1.5 text-xs text-emerald-500">
                            <Check className="h-3 w-3" />
                            Acked
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleAcknowledge(alert.id)}
                            disabled={acknowledgeMutation.isPending}
                          >
                            <Check className="h-4 w-4" />
                            <span className="sr-only">Acknowledge</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Alerting Policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Alerts are automatically generated by the Edge-Cloud Orchestrator
              runtime based on system events, ML drift detection, and resource
              utilization thresholds.
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                Circuit Breakers (CRITICAL): Triggered when service-to-service
                communication fails.
              </li>
              <li>
                ML Drift (HIGH): Triggered when PSI or MAE thresholds are
                exceeded.
              </li>
              <li>Node Failures (HIGH): Triggered on heartbeat timeouts.</li>
              <li>
                Queue Backlog (MEDIUM): Triggered when task pending depth {">"}{" "}
                50.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Retention & TTL
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              The alerting system is backed by a high-performance Redis store
              for real-time responsiveness.
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Alerts are automatically purged after 24 hours (TTL).</li>
              <li>Acknowledged alerts remain visible until the TTL expires.</li>
              <li>
                Critical alerts are mirrored to the audit log for long-term
                compliance.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
