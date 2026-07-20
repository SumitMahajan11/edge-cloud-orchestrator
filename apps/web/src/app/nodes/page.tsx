"use client";

import { useMemo, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NodeStatsBar } from "@/components/nodes/NodeStatsBar";
import {
  NodeFilterBar,
  type NodeStatusFilter,
  type NodeSortKey,
  type NodeViewMode,
} from "@/components/nodes/NodeFilterBar";
import { NodesTableView } from "@/components/nodes/NodesTableView";
import { NodesCardGridView } from "@/components/nodes/NodesCardGridView";
import { NodeDetailSheet } from "@/components/nodes/NodeDetailSheet";
import { AddNodeModal } from "@/components/modals/AddNodeModal";
import {
  useNodes,
  useDrainNode,
  useForceOfflineNode,
  useRegisterNode,
  useRotateCertificate,
} from "@/hooks/useNodes";
import { useTasks } from "@/hooks/useTasks";
import { useLogs } from "@/hooks/useLogs";
import type { EdgeNode } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { isApiClientError } from "@edgecloud/api-client";
import { useRouter } from "next/navigation";

export default function EdgeNodesPage() {
  const router = useRouter();
  const { data: nodes = [], isLoading: nodesLoading } = useNodes();
  const { data: tasks = [] } = useTasks();
  const { data: logs = [] } = useLogs();

  const drainMutation = useDrainNode();
  const offlineMutation = useForceOfflineNode();
  const registerMutation = useRegisterNode();
  const rotateCertMutation = useRotateCertificate();

  const { hasPermission } = useAuth();
  const canRegister = hasPermission("nodes:create");
  const canDrain = hasPermission("nodes:update");
  const canForce = hasPermission("nodes:delete");
  const canRotate = hasPermission("nodes:update");

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<NodeStatusFilter>("all");
  const [region, setRegion] = useState<string>("__all__");
  const [sortBy, setSortBy] = useState<NodeSortKey>("cpu");
  const [view, setView] = useState<NodeViewMode>("table");

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const regions = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((n) => n.region && set.add(n.region));
    return Array.from(set).sort();
  }, [nodes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = nodes.filter((n) => {
      if (q) {
        const hit =
          n.id.toLowerCase().includes(q) ||
          n.name.toLowerCase().includes(q) ||
          n.region?.toLowerCase().includes(q) ||
          n.location?.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (status !== "all") {
        if (status === "draining") {
          if (!n.isMaintenanceMode) return false;
        } else if (n.status !== status) {
          return false;
        }
      }
      if (region !== "__all__" && n.region !== region) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "cpu":
          return b.cpu - a.cpu;
        case "memory":
          return b.memory - a.memory;
        case "latency":
          return a.latency - b.latency;
        case "tasks":
          return b.tasksRunning - a.tasksRunning;
        case "heartbeat":
          return (
            new Date(b.lastHeartbeat).getTime() -
            new Date(a.lastHeartbeat).getTime()
          );
        default:
          return 0;
      }
    });
    return list;
  }, [nodes, search, status, region, sortBy]);

  const handleDrain = async (node: EdgeNode) => {
    try {
      await drainMutation.mutateAsync(node.id);
      toast.success(`Node ${node.name} is now draining`);
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.isUnauthorized()) {
          router.push("/login");
          return;
        }
        toast.error(error.response.message);
      } else {
        toast.error("Failed to drain node");
      }
    }
  };

  const handleForceOffline = async (node: EdgeNode) => {
    try {
      await offlineMutation.mutateAsync(node.id);
      toast.success(`Node ${node.name} forced offline`);
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.isUnauthorized()) {
          router.push("/login");
          return;
        }
        toast.error(error.response.message);
      } else {
        toast.error("Failed to force node offline");
      }
    }
  };

  const handleRotateCertificate = async (node: EdgeNode) => {
    try {
      await rotateCertMutation.mutateAsync(node.id);
      toast.success(`Certificate for ${node.name} rotated successfully`);
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.isUnauthorized()) {
          router.push("/login");
          return;
        }
        toast.error(error.response.message);
      } else {
        toast.error("Failed to rotate node certificate");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Edge Nodes
          </h1>
          <p className="text-muted-foreground">
            Manage your distributed edge infrastructure
          </p>
        </div>
        {canRegister && (
          <Button onClick={() => setIsAddModalOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Register Node
          </Button>
        )}
      </div>

      <NodeStatsBar nodes={nodes} />

      <NodeFilterBar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        region={region}
        onRegion={setRegion}
        regions={regions}
        sortBy={sortBy}
        onSort={setSortBy}
        view={view}
        onView={setView}
      />

      {nodesLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : view === "table" ? (
        <NodesTableView
          nodes={filtered}
          onSelect={(n) => {
            setSelectedNodeId(n.id);
            setIsSheetOpen(true);
          }}
          onDrain={canDrain ? handleDrain : undefined}
          onForceOffline={canForce ? handleForceOffline : undefined}
        />
      ) : (
        <NodesCardGridView
          nodes={filtered}
          onSelect={(n) => {
            setSelectedNodeId(n.id);
            setIsSheetOpen(true);
          }}
        />
      )}

      {selectedNode && (
        <NodeDetailSheet
          node={selectedNode}
          tasks={tasks.filter((t) => t.nodeId === selectedNode.id)}
          logs={logs.filter((l) => l.nodeId === selectedNode.id)}
          open={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          onDrain={canDrain ? handleDrain : undefined}
          onForceOffline={canForce ? handleForceOffline : undefined}
          onRotateCertificate={canRotate ? handleRotateCertificate : undefined}
        />
      )}

      <AddNodeModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={async (data) => {
          try {
            await registerMutation.mutateAsync(data);
            setIsAddModalOpen(false);
            toast.success(`Node ${data.name} registered successfully`);
          } catch (error) {
            if (isApiClientError(error)) {
              if (error.isUnauthorized()) {
                router.push("/login");
                return;
              }
              toast.error(error.response.message);
            } else {
              toast.error("Failed to register node");
            }
          }
        }}
      />
    </div>
  );
}
