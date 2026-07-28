import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Server, MapPin, Wifi } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { EdgeNode } from "../../types";
import { cn } from "../../lib/utils";

interface AddNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (nodeData: Partial<EdgeNode>) => void;
}

const REGIONS = [
  "us-east-1",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-south-1",
  "ap-southeast-1",
  "ap-northeast-1",
  "sa-east-1",
];

const NODE_TYPES = [
  {
    value: "edge",
    label: "Edge Node",
    description: "Low-latency edge computing",
  },
  {
    value: "cloud",
    label: "Cloud Node",
    description: "High-capacity cloud computing",
  },
  {
    value: "hybrid",
    label: "Hybrid Node",
    description: "Combined edge and cloud",
  },
];

export function AddNodeModal({ isOpen, onClose, onSubmit }: AddNodeModalProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    region: "us-east-1",
    nodeType: "edge",
    ip: "",
    cpu: 4,
    memory: 8192,
    storage: 100,
    costPerHour: 0.05,
    maxTasks: 10,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = (s: number) => {
    const newErrors: Record<string, string> = {};

    if (s === 1) {
      if (!formData.name.trim()) newErrors.name = "Node name is required";
      if (!formData.location.trim())
        newErrors.location = "Location is required";
    } else if (s === 2) {
      if (!formData.ip.trim()) {
        newErrors.ip = "IP address is required";
      } else {
        const parts = formData.ip.trim().split(".");
        const valid =
          parts.length === 4 &&
          parts.every((p) => {
            const n = parseInt(p, 10);
            return /^\d+$/.test(p) && n >= 0 && n <= 255;
          });
        if (!valid) newErrors.ip = "Invalid IP format";
      }
    } else if (s === 3) {
      if (formData.cpu < 1) newErrors.cpu = "Min 1 core";
      if (formData.memory < 512) newErrors.memory = "Min 512 MB";
      if (formData.storage < 10) newErrors.storage = "Min 10 GB";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(step)) setStep((s) => s + 1);
  };

  const handleBack = () => {
    setStep((s) => s - 1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(3)) return;

    const nodeData: Partial<EdgeNode> = {
      ...formData,
      status: "offline",
      tasksRunning: 0,
      latency: 0,
      uptime: 0,
      url: `http://${formData.ip}:4001`,
      bandwidthIn: 0,
      bandwidthOut: 0,
      healthHistory: [],
      isMaintenanceMode: false,
    };

    onSubmit(nodeData);
    handleClose();
  };

  const handleClose = () => {
    setStep(1);
    setFormData({
      name: "",
      location: "",
      region: "us-east-1",
      nodeType: "edge",
      ip: "",
      cpu: 4,
      memory: 8192,
      storage: 100,
      costPerHour: 0.05,
      maxTasks: 10,
    });
    setErrors({});
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="add-node-modal-wrapper"
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
              {/* Progress Header */}
              <div className="bg-secondary/30 px-6 py-4 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Server className="h-4 w-4 text-primary" />
                    </div>
                    <h2 className="text-lg font-semibold">Node Registration</h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-1 hover:bg-secondary rounded-md"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-all duration-300",
                        step >= i ? "bg-primary" : "bg-border",
                      )}
                    />
                  ))}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6">
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div
                      key="step1"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      <h3 className="text-sm font-medium text-muted-foreground uppercase">
                        Step 1: Identity
                      </h3>
                      <div className="space-y-2">
                        <label className="text-xs font-mono uppercase text-muted-foreground">
                          Node Name
                        </label>
                        <Input
                          placeholder="e.g. edge-lon-01"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                          className={errors.name ? "border-destructive" : ""}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-mono uppercase text-muted-foreground">
                          Location
                        </label>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="London, UK"
                            className={cn(
                              "pl-10",
                              errors.location && "border-destructive",
                            )}
                            value={formData.location}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                location: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Region
                          </label>
                          <Select
                            value={formData.region}
                            onValueChange={(v) =>
                              setFormData({ ...formData, region: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {REGIONS.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Type
                          </label>
                          <Select
                            value={formData.nodeType}
                            onValueChange={(v) =>
                              setFormData({ ...formData, nodeType: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {NODE_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      <h3 className="text-sm font-medium text-muted-foreground uppercase">
                        Step 2: Connectivity
                      </h3>
                      <div className="space-y-2">
                        <label className="text-xs font-mono uppercase text-muted-foreground">
                          Static IP Address
                        </label>
                        <div className="relative">
                          <Wifi className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="1.2.3.4"
                            className={cn(
                              "pl-10",
                              errors.ip && "border-destructive",
                            )}
                            value={formData.ip}
                            onChange={(e) =>
                              setFormData({ ...formData, ip: e.target.value })
                            }
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground italic">
                          Node must be reachable on port 4001
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div
                      key="step3"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      <h3 className="text-sm font-medium text-muted-foreground uppercase">
                        Step 3: Hardware
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            CPU Cores
                          </label>
                          <Input
                            type="number"
                            value={formData.cpu}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                cpu: parseInt(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Memory (MB)
                          </label>
                          <Input
                            type="number"
                            value={formData.memory}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                memory: parseInt(e.target.value),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-mono uppercase text-muted-foreground">
                          Max Concurrent Tasks
                        </label>
                        <Input
                          type="number"
                          value={formData.maxTasks}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              maxTasks: parseInt(e.target.value),
                            })
                          }
                        />
                      </div>
                    </motion.div>
                  )}

                  {step === 4 && (
                    <motion.div
                      key="step4"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      <h3 className="text-sm font-medium text-muted-foreground uppercase">
                        Step 4: Review
                      </h3>
                      <div className="rounded-lg bg-secondary/20 p-4 space-y-3 border border-border">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">NODE:</span>
                          <span className="text-foreground">
                            {formData.name}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">TYPE:</span>
                          <span className="text-foreground uppercase">
                            {formData.nodeType}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">REGION:</span>
                          <span className="text-foreground">
                            {formData.region}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">
                            RESOURCES:
                          </span>
                          <span className="text-foreground">
                            {formData.cpu}vCPU / {formData.memory}MB
                          </span>
                        </div>
                      </div>
                      <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <p className="text-[10px] text-primary leading-tight">
                          By registering, this node will attempt to establish an
                          mTLS handshake with the orchestrator.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex justify-between mt-8">
                  {step > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBack}
                    >
                      Back
                    </Button>
                  ) : (
                    <div />
                  )}

                  {step < 4 ? (
                    <Button
                      type="button"
                      onClick={handleNext}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      Next Step
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      className="bg-[#00d4aa] hover:bg-[#00d4aa]/90 text-[#0a0a0f]"
                    >
                      Register Node
                    </Button>
                  )}
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
