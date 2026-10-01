import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shield } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SchedulingPolicy } from "@/hooks/usePolicies";

interface CreatePolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: any) => void;
  initialData?: SchedulingPolicy | null;
}

export function CreatePolicyModal({ isOpen, onClose, onSubmit, initialData }: CreatePolicyModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    type: "LATENCY",
    maxLatencyMs: 150,
    minGreenPercent: 80,
    maxCostUSD: 0.05,
    isActive: false,
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name.replace(/ - [a-f0-9-]+$/, ""),
        type: initialData.type || "LATENCY",
        maxLatencyMs: initialData.config?.maxLatencyMs ?? 150,
        minGreenPercent: initialData.config?.minGreenPercent ?? 80,
        maxCostUSD: initialData.config?.maxCostUSD ?? 0.05,
        isActive: !!initialData.isActive,
      });
    } else {
      setFormData({
        name: "",
        type: "LATENCY",
        maxLatencyMs: 150,
        minGreenPercent: 80,
        maxCostUSD: 0.05,
        isActive: false,
      });
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {return;}

    let config: Record<string, any> = {};
    if (formData.type === "LATENCY") {
      config = { maxLatencyMs: Number(formData.maxLatencyMs) };
    } else if (formData.type === "CARBON") {
      config = { minGreenPercent: Number(formData.minGreenPercent) };
    } else if (formData.type === "COST") {
      config = { maxCostUSD: Number(formData.maxCostUSD) };
    }

    onSubmit?.({
      id: initialData?.id,
      name: formData.name,
      type: formData.type,
      config,
      isActive: formData.isActive,
    });

    handleClose();
  };

  const handleClose = () => {
    setFormData({
      name: "",
      type: "LATENCY",
      maxLatencyMs: 150,
      minGreenPercent: 80,
      maxCostUSD: 0.05,
      isActive: false,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="create-policy-modal-wrapper"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50"
        >
          <div
            onClick={handleClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden pointer-events-auto">
              <div className="bg-secondary/30 px-6 py-4 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <h2 className="text-lg font-semibold">
                      {initialData ? "Edit Scheduling Policy" : "Create Scheduling Policy"}
                    </h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-1 hover:bg-secondary rounded-md"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      Policy Name
                    </label>
                    <Input
                      placeholder="e.g. Ultra-Low Latency Guard"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      Policy Type
                    </label>
                    <Select
                      value={formData.type}
                      onValueChange={(v) =>
                        setFormData({ ...formData, type: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LATENCY">Latency SLA Guard</SelectItem>
                        <SelectItem value="CARBON">Eco-First Optimization</SelectItem>
                        <SelectItem value="COST">Cost Guardrail</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.type === "LATENCY" && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className="text-xs font-mono uppercase text-muted-foreground">
                        Max Latency SLA (ms)
                      </label>
                      <Input
                        type="number"
                        min={1}
                        value={formData.maxLatencyMs}
                        onChange={(e) =>
                          setFormData({ ...formData, maxLatencyMs: Number(e.target.value) })
                        }
                        required
                      />
                    </div>
                  )}

                  {formData.type === "CARBON" && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className="text-xs font-mono uppercase text-muted-foreground">
                        Min Green/Eco Energy percentage (%)
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={formData.minGreenPercent}
                        onChange={(e) =>
                          setFormData({ ...formData, minGreenPercent: Number(e.target.value) })
                        }
                        required
                      />
                    </div>
                  )}

                  {formData.type === "COST" && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className="text-xs font-mono uppercase text-muted-foreground">
                        Max Node Cost (USD/hour)
                      </label>
                      <Input
                        type="number"
                        step="0.001"
                        min={0}
                        value={formData.maxCostUSD}
                        onChange={(e) =>
                          setFormData({ ...formData, maxCostUSD: Number(e.target.value) })
                        }
                        required
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={formData.isActive}
                      onChange={(e) =>
                        setFormData({ ...formData, isActive: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary"
                    />
                    <label htmlFor="isActive" className="text-sm text-foreground select-none cursor-pointer">
                      Activate Policy Immediately (Overrides current active policy)
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {initialData ? "Save Changes" : "Create Policy"}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
