"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { useTenant } from "../../contexts/TenantContext";
import { apiClient } from "../../lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Terminal } from "lucide-react";
import { isApiClientError } from "@edgecloud/api-client";

export default function TenantsPage() {
  const tenant = useTenant();

  const [eventType, setEventType] = useState("task.created");
  const [mode, setMode] = useState<"single" | "range">("single");
  const [entityId, setEntityId] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!tenant.isSuperAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p>You must be a SUPER_ADMIN to view this page.</p>
      </div>
    );
  }

  const handleRepublish = async () => {
    setShowConfirm(false);
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (mode === "single") {
        const res = await apiClient.post<{ success: boolean; topic: string }>(
          "/v2/admin/events/republish",
          {
            eventType,
            entityId,
          },
        );
        setResult(`Successfully republished event to topic ${res.topic}`);
      } else {
        const res = await apiClient.post<{
          count?: number;
          events?: any[];
          published?: number;
          failed?: number;
          errors?: string[];
        }>("/v2/admin/events/republish-range", {
          eventType,
          fromTimestamp: new Date(fromTime).toISOString(),
          toTimestamp: new Date(toTime).toISOString(),
          dryRun,
        });
        if (dryRun) {
          setResult(
            `Dry run found ${res.count ?? 0} events to republish. Preview: ${JSON.stringify(res.events ?? [], null, 2)}`,
          );
        } else {
          setResult(
            `${res.published ?? 0} events republished successfully. ${res.failed ?? 0} failed. Errors: ${JSON.stringify(res.errors ?? [])}`,
          );
        }
      }
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        // We do not have router in this component, so we just set error state
        setError(error.response.message || "An error occurred");
      } else {
        setError(
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        );
        console.error("Unexpected error in tenants page:", error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Tenants & Administration
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage tenants and perform system recovery operations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event Replay</CardTitle>
          <CardDescription>
            Republish lost events to Kafka for testing or recovery purposes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger>
                <SelectValue placeholder="Select event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task.created">Task Created</SelectItem>
                <SelectItem value="node.registered">Node Registered</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Replay Mode</Label>
            <Select value={mode} onValueChange={(val: any) => setMode(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single Entity</SelectItem>
                <SelectItem value="range">Time Range (Bulk)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "single" ? (
            <div className="space-y-2">
              <Label>Entity ID</Label>
              <Input
                placeholder="Enter task ID or node ID..."
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Time (Local)</Label>
                <Input
                  type="datetime-local"
                  value={fromTime}
                  onChange={(e) => setFromTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>To Time (Local)</Label>
                <Input
                  type="datetime-local"
                  value={toTime}
                  onChange={(e) => setToTime(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2 col-span-2 pt-2">
                <Switch
                  id="dry-run"
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                />
                <Label htmlFor="dry-run">Dry Run (Show count only)</Label>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-border">
            {!showConfirm ? (
              <Button
                onClick={() => setShowConfirm(true)}
                disabled={
                  loading ||
                  (mode === "single" && !entityId) ||
                  (mode === "range" && (!fromTime || !toTime))
                }
              >
                Prepare Republish
              </Button>
            ) : (
              <div className="space-y-4">
                <Alert className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    Are you sure you want to republish these events? This will
                    trigger downstream systems.
                  </AlertDescription>
                </Alert>
                <div className="flex space-x-4">
                  <Button
                    variant="destructive"
                    onClick={handleRepublish}
                    disabled={loading}
                  >
                    {loading ? "Republishing..." : "Confirm Republish"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowConfirm(false)}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert className="bg-green-500/10 text-green-600 border-green-500/20">
              <AlertTitle>Result</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                {result}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
