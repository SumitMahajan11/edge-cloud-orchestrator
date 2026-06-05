"use client";

import { useState } from "react";
import {
  Webhook,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Edit2,
  Play,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default function WebhooksPage() {
  const [search, setSearch] = useState("");

  const webhooks = [
    {
      id: "wh-001",
      name: "Slack Alerts",
      url: "https://hooks.slack.com/services/...",
      events: ["TASK_FAILED", "NODE_OFFLINE"],
      status: "active",
      lastDelivery: "success",
      latency: "124ms",
    },
    {
      id: "wh-002",
      name: "Custom SIEM Integration",
      url: "https://api.internal.security/v1/logs",
      events: ["AUTH_AUDIT", "POLICY_VIOLATION"],
      status: "active",
      lastDelivery: "success",
      latency: "45ms",
    },
    {
      id: "wh-003",
      name: "Legacy Monitoring Bridge",
      url: "https://metrics.legacy.it/collect",
      events: ["METRIC_THRESHOLD"],
      status: "error",
      lastDelivery: "failure",
      latency: "N/A",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Outbound Webhooks
          </h1>
          <p className="text-muted-foreground">
            Subscribe to real-time system events
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Register Webhook
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Deliveries (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12,402</div>
            <div className="flex items-center gap-1 text-xs text-emerald-400 mt-1">
              <CheckCircle2 className="h-3 w-3" /> 99.4% success rate
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Failed Deliveries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-400">74</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" /> 12 retries pending
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">142ms</div>
            <div className="flex items-center gap-1 text-xs text-teal-400 mt-1">
              <Webhook className="h-3 w-3" /> 8 active endpoints
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Endpoints</CardTitle>
            <div className="flex gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter webhooks..."
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
                <TableHead>Endpoint Name</TableHead>
                <TableHead>Target URL</TableHead>
                <TableHead>Subscriptions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((hook) => (
                <TableRow key={hook.id} className="border-border/50 group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-8 w-8 rounded bg-background flex items-center justify-center border ${
                          hook.status === "active"
                            ? "border-teal-500/20"
                            : "border-rose-500/20"
                        }`}
                      >
                        <Webhook
                          className={`h-4 w-4 ${
                            hook.status === "active"
                              ? "text-teal-400"
                              : "text-rose-400"
                          }`}
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">{hook.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {hook.id}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    <span className="text-sm text-muted-foreground font-mono">
                      {hook.url}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {hook.events.map((e) => (
                        <Badge
                          key={e}
                          variant="outline"
                          className="text-[9px] px-1 h-4"
                        >
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        hook.status === "active"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      }
                    >
                      {hook.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {hook.lastDelivery === "success" ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <XCircle className="h-3 w-3 text-rose-400" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {hook.latency}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Play className="h-4 w-4 text-teal-400" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
