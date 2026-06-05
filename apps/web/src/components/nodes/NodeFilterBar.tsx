import { Search, LayoutGrid, Rows } from "lucide-react";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "../../lib/utils";

export type NodeStatusFilter =
  | "all"
  | "online"
  | "degraded"
  | "offline"
  | "draining";
export type NodeSortKey = "cpu" | "memory" | "latency" | "tasks" | "heartbeat";
export type NodeViewMode = "table" | "grid";

interface NodeFilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  status: NodeStatusFilter;
  onStatus: (v: NodeStatusFilter) => void;
  region: string;
  onRegion: (v: string) => void;
  regions: string[];
  sortBy: NodeSortKey;
  onSort: (v: NodeSortKey) => void;
  view: NodeViewMode;
  onView: (v: NodeViewMode) => void;
}

export function NodeFilterBar({
  search,
  onSearch,
  status,
  onStatus,
  region,
  onRegion,
  regions,
  sortBy,
  onSort,
  view,
  onView,
}: NodeFilterBarProps) {
  return (
    <div className="card-brief p-4 flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter by name / ID / region"
          className="pl-8 bg-[#0a0a0f] border-[#1e1e2e] font-mono text-xs"
        />
      </div>

      {/* Status tabs */}
      <Tabs
        value={status}
        onValueChange={(v) => onStatus(v as NodeStatusFilter)}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="online">Online</TabsTrigger>
          <TabsTrigger value="degraded">Degraded</TabsTrigger>
          <TabsTrigger value="offline">Offline</TabsTrigger>
          <TabsTrigger value="draining">Draining</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Region */}
      <Select value={region} onValueChange={onRegion}>
        <SelectTrigger className="w-[160px] bg-[#0a0a0f] border-[#1e1e2e] font-mono text-xs">
          <SelectValue placeholder="All regions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All regions</SelectItem>
          {regions.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Sort */}
      <Select value={sortBy} onValueChange={(v) => onSort(v as NodeSortKey)}>
        <SelectTrigger className="w-[160px] bg-[#0a0a0f] border-[#1e1e2e] font-mono text-xs">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cpu">Sort: CPU %</SelectItem>
          <SelectItem value="memory">Sort: Memory %</SelectItem>
          <SelectItem value="latency">Sort: Latency</SelectItem>
          <SelectItem value="tasks">Sort: Tasks</SelectItem>
          <SelectItem value="heartbeat">Sort: Last Heartbeat</SelectItem>
        </SelectContent>
      </Select>

      {/* View toggle */}
      <div className="inline-flex rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] p-1">
        <button
          type="button"
          onClick={() => onView("table")}
          className={cn(
            "px-2 py-1 rounded font-mono text-xs transition-colors",
            view === "table"
              ? "bg-[#00d4aa]/10 text-[#00d4aa]"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={view === "table"}
        >
          <Rows className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onView("grid")}
          className={cn(
            "px-2 py-1 rounded font-mono text-xs transition-colors",
            view === "grid"
              ? "bg-[#00d4aa]/10 text-[#00d4aa]"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={view === "grid"}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
