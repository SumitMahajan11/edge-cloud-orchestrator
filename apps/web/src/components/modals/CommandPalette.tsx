import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Server,
  Calendar,
  Activity,
  ScrollText,
  Settings,
  Search,
  Command,
  Plus,
  Zap,
  Globe,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useSubmitTask } from "../../hooks/useTasks";
import { useRegisterNode } from "../../hooks/useNodes";
import { useUpdatePolicy } from "../../hooks/usePolicies";
import { toast } from "sonner";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  group: "navigation" | "actions";
  action: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const submitTask = useSubmitTask();
  const registerNode = useRegisterNode();
  const updatePolicy = useUpdatePolicy();

  const commands: CommandItem[] = useMemo(
    () => [
      // Navigation
      {
        id: "dashboard",
        label: "Go to Dashboard",
        icon: LayoutDashboard,
        shortcut: "G D",
        group: "navigation",
        action: () => {
          router.push("/");
          onClose();
        },
      },
      {
        id: "nodes",
        label: "Go to Edge Nodes",
        icon: Server,
        shortcut: "G N",
        group: "navigation",
        action: () => {
          router.push("/nodes");
          onClose();
        },
      },
      {
        id: "scheduler",
        label: "Go to Task Scheduler",
        icon: Calendar,
        shortcut: "G T",
        group: "navigation",
        action: () => {
          router.push("/scheduler");
          onClose();
        },
      },
      {
        id: "monitoring",
        label: "Go to Monitoring",
        icon: Activity,
        shortcut: "G M",
        group: "navigation",
        action: () => {
          router.push("/monitoring");
          onClose();
        },
      },
      {
        id: "logs",
        label: "Go to Logs",
        icon: ScrollText,
        shortcut: "G L",
        group: "navigation",
        action: () => {
          router.push("/logs");
          onClose();
        },
      },
      {
        id: "policies",
        label: "Go to Policies",
        icon: Settings,
        shortcut: "G P",
        group: "navigation",
        action: () => {
          router.push("/policies");
          onClose();
        },
      },
      // Actions
      {
        id: "quick-task",
        label: "Quick Submit: Image Processing",
        icon: Zap,
        group: "actions",
        action: async () => {
          try {
            await submitTask.mutateAsync({
              name: `cmd-palette-image-${Date.now().toString(36)}`,
              type: "Image Classification",
              priority: "high",
              runtime: "docker",
              image: "edgecloud/worker:latest",
              specs: { cpuCores: 2, memoryGB: 4 },
            });
            toast.success("Quick task submitted");
            onClose();
          } catch (err) {
            toast.error("Failed to submit quick task");
          }
        },
      },
      {
        id: "register-node",
        label: "Register New Edge Node",
        icon: Plus,
        group: "actions",
        action: async () => {
          try {
            await registerNode.mutateAsync({
              name: `edge-node-${Date.now().toString(36)}`,
              location: "New York, US",
              region: "us-east-1",
              ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
            });
            toast.success("New node registered");
            onClose();
          } catch (err) {
            toast.error("Failed to register node");
          }
        },
      },
      {
        id: "switch-policy-efficiency",
        label: "Switch Policy: Efficiency",
        icon: Globe,
        group: "actions",
        action: async () => {
          try {
            await updatePolicy.mutateAsync("efficiency");
            toast.success("Global policy switched to Efficiency");
            onClose();
          } catch (err) {
            toast.error("Failed to update policy");
          }
        },
      },
    ],
    [router, onClose, submitTask, registerNode, updatePolicy],
  );

  const filteredCommands = useMemo(() => {
    if (!searchQuery) return commands;
    const query = searchQuery.toLowerCase();
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(query));
  }, [commands, searchQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          filteredCommands[selectedIndex]?.action();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg z-[101]"
          >
            <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/20">
                <Search className="h-5 w-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Type a command or search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                  autoFocus
                />
                <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  <Command className="h-3 w-3" />K
                </kbd>
              </div>

              <div className="max-h-[400px] overflow-y-auto py-2">
                {filteredCommands.length > 0 ? (
                  ["navigation", "actions"].map((group) => {
                    const groupCommands = filteredCommands.filter(
                      (c) => c.group === group,
                    );
                    if (groupCommands.length === 0) return null;

                    return (
                      <div key={group}>
                        <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                          {group}
                        </div>
                        {groupCommands.map((command) => {
                          const Icon = command.icon;
                          const globalIndex = filteredCommands.findIndex(
                            (c) => c.id === command.id,
                          );
                          const isSelected = globalIndex === selectedIndex;

                          return (
                            <button
                              key={command.id}
                              onClick={command.action}
                              onMouseEnter={() => setSelectedIndex(globalIndex)}
                              className={cn(
                                "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                isSelected
                                  ? "bg-primary/10 border-r-2 border-primary"
                                  : "hover:bg-secondary/50",
                              )}
                            >
                              <div
                                className={cn(
                                  "p-1.5 rounded-md",
                                  isSelected
                                    ? "bg-primary/20 text-primary"
                                    : "bg-secondary text-muted-foreground",
                                )}
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                              <span
                                className={cn(
                                  "flex-1 text-sm",
                                  isSelected
                                    ? "text-primary font-medium"
                                    : "text-foreground",
                                )}
                              >
                                {command.label}
                              </span>
                              {command.shortcut && (
                                <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-secondary/50 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                                  {command.shortcut}
                                </kbd>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                ) : (
                  <div className="px-4 py-8 text-center text-muted-foreground">
                    No results for "{searchQuery}"
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-secondary/30 text-[10px] text-muted-foreground">
                <div className="flex gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-secondary px-1.5 py-0.5">↑↓</kbd>
                    Navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-secondary px-1.5 py-0.5">↵</kbd>
                    Execute
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-secondary px-1.5 py-0.5">Esc</kbd>
                  Close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
