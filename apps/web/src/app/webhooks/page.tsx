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
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
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
import { useWebhooks, useWebhookStats, useCreateWebhook } from "@/hooks/useWebhooks";
import { RegisterWebhookModal } from "@/components/modals/RegisterWebhookModal";
import { toast } from "sonner";

export default function WebhooksPage() {
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: webhooksRaw, isLoading: webhooksLoading } = useWebhooks();
  const { data: stats, isLoading: statsLoading } = useWebhookStats();
  const createWebhookMutation = useCreateWebhook();

  // Normalise: the API returns { data: [], pagination: {} }
  const webhooks: any[] = Array.isArray(webhooksRaw)
    ? webhooksRaw
    : (webhooksRaw as any)?.data ?? [];

  const filtered = webhooks.filter((h: any) =>
    !search ||
    h.name?.toLowerCase().includes(search.toLowerCase()) ||
    h.url?.toLowerCase().includes(search.toLowerCase())
  );

  // Derive total deliveries from per-webhook _count if available
  const totalDeliveries = webhooks.reduce(
    (sum: number, h: any) => sum + (h._count?.deliveries ?? 0),
    0
  );

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
        <Button className="gap-2" onClick={() => setIsModalOpen(true)}>
          <Plus className="h-4 w-4" /> Register Webhook
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Deliveries (all-time)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? "—" : totalDeliveries.toLocaleString()}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <CheckCircle2 className="h-3 w-3" />
              {stats ? `${stats.active ?? 0} active endpoints` : "Loading…"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Failed Deliveries (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-400">
              {statsLoading ? "—" : (stats?.failedLast24h ?? 0)}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" /> Last 24 hours
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? "—" : `${stats?.avgLatency ?? "—"}ms`}
            </div>
            <div className="flex items-center gap-1 text-xs text-teal-400 mt-1">
              <Webhook className="h-3 w-3" />
              {statsLoading ? "Loading…" : `${stats?.total ?? 0} registered`}
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
          {webhooksLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading endpoints…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {webhooks.length === 0
                ? "No webhooks registered. Click \"Register Webhook\" to add one."
                : "No endpoints match the current filter."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead>Endpoint Name</TableHead>
                  <TableHead>Target URL</TableHead>
                  <TableHead>Subscriptions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deliveries</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((hook: any) => {
                  const isActive = hook.enabled !== false;
                  const events: string[] = Array.isArray(hook.events)
                    ? hook.events
                    : [];
                  return (
                    <TableRow key={hook.id} className="border-border/50 group">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-8 w-8 rounded bg-background flex items-center justify-center border ${
                              isActive
                                ? "border-teal-500/20"
                                : "border-rose-500/20"
                            }`}
                          >
                            <Webhook
                              className={`h-4 w-4 ${
                                isActive ? "text-teal-400" : "text-rose-400"
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
                          {events.slice(0, 3).map((e) => (
                            <Badge
                              key={e}
                              variant="outline"
                              className="text-[9px] px-1 h-4"
                            >
                              {e}
                            </Badge>
                          ))}
                          {events.length > 3 && (
                            <Badge variant="outline" className="text-[9px] px-1 h-4">
                              +{events.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            isActive
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          }
                        >
                          {isActive ? "ACTIVE" : "DISABLED"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {hook._count?.deliveries != null ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              <span className="text-xs text-muted-foreground">
                                {hook._count.deliveries} total
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <RegisterWebhookModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (data) => {
          try {
            await createWebhookMutation.mutateAsync({
              name: data.name,
              url: data.url,
              events: [data.event],
              enabled: true,
            });
            toast.success("Webhook registered successfully");
          } catch (err: any) {
            toast.error(err.message || "Failed to register webhook");
          }
        }}
      />
    </div>
  );
}
