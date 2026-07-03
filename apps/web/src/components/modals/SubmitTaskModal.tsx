import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Cpu, Server, Compass, Layers } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useSubmitTask } from "../../hooks/useTasks";
import { useNodes } from "../../hooks/useNodes";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import type { TaskPriority, TaskType, RuntimeType } from "../../types";

interface SubmitTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TASK_TYPES: TaskType[] = [
  "Model Inference",
  "Image Classification",
  "Log Analysis",
  "Data Aggregation",
  "Anomaly Detection",
];

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const RUNTIMES: RuntimeType[] = ["docker", "native", "wasm"];

export function SubmitTaskModal({ isOpen, onClose }: SubmitTaskModalProps) {
  const submitTask = useSubmitTask();
  const { data: nodes = [] } = useNodes();
  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    name: "",
    type: "Model Inference" as TaskType,
    priority: "medium" as TaskPriority,
    runtime: "docker" as RuntimeType,
    image: "alpine:latest",
    cpuCores: 2,
    memoryGB: 4,
    nodeId: "auto",
    affinity: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = (s: number) => {
    const newErrors: Record<string, string> = {};

    if (s === 1) {
      if (!formData.name.trim()) newErrors.name = "Task name is required";
      if (!formData.image.trim()) newErrors.image = "Container image/WASM path is required";
    } else if (s === 2) {
      if (formData.cpuCores < 1) newErrors.cpuCores = "Min 1 core";
      if (formData.memoryGB < 1) newErrors.memoryGB = "Min 1 GB";
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all steps before final submission
    const step1Valid = validateStep(1);
    const step2Valid = validateStep(2);
    if (!step1Valid || !step2Valid) {
      // Jump back to the first step that has errors
      if (!step1Valid) setStep(1);
      return;
    }

    try {
      const payload: any = {
        name: formData.name,
        type: formData.type,
        priority: formData.priority,
        runtime: formData.runtime,
        image: formData.image,
        specs: {
          cpuCores: formData.cpuCores,
          memoryGB: formData.memoryGB,
        },
      };

      if (formData.nodeId && formData.nodeId !== "auto") {
        payload.nodeId = formData.nodeId;
      }
      if (formData.affinity.trim()) {
        payload.affinity = formData.affinity.trim();
      }

      await submitTask.mutateAsync(payload);
      toast.success("Task scheduled successfully!");
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit task");
    }
  };

  const handleClose = () => {
    setStep(1);
    setFormData({
      name: "",
      type: "Model Inference",
      priority: "medium",
      runtime: "docker",
      image: "alpine:latest",
      cpuCores: 2,
      memoryGB: 4,
      nodeId: "auto",
      affinity: "",
    });
    setErrors({});
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden pointer-events-auto">
              {/* Header */}
              <div className="bg-secondary/30 px-6 py-4 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Play className="h-4 w-4 text-primary animate-pulse" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Schedule Workload</h2>
                      <p className="text-xs text-muted-foreground">Deploy native, dockerized, or WASM tasks</p>
                    </div>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-1 hover:bg-secondary rounded-md"
                  >
                    <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3].map((i) => (
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
                      <div className="flex items-center gap-2 mb-2">
                        <Layers className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">
                          Step 1: Configuration
                        </h3>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-mono uppercase text-muted-foreground">
                          Task Name
                        </label>
                        <Input
                          placeholder="e.g. image-processing-run"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                          className={errors.name ? "border-destructive" : ""}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Task Type
                          </label>
                          <Select
                            value={formData.type}
                            onValueChange={(v) =>
                              setFormData({ ...formData, type: v as TaskType })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TASK_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Priority
                          </label>
                          <Select
                            value={formData.priority}
                            onValueChange={(v) =>
                              setFormData({ ...formData, priority: v as TaskPriority })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PRIORITIES.map((p) => (
                                <SelectItem key={p} value={p}>
                                  <span className="capitalize">{p}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Runtime
                          </label>
                          <Select
                            value={formData.runtime}
                            onValueChange={(v) => {
                              const defaultImage = v === "wasm" ? "main.wasm" : "alpine:latest";
                              setFormData({
                                ...formData,
                                runtime: v as RuntimeType,
                                image: defaultImage,
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RUNTIMES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  <span className="uppercase">{r}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Image / Executable Path
                          </label>
                          <Input
                            placeholder={formData.runtime === "wasm" ? "http://.../main.wasm" : "alpine:latest"}
                            value={formData.image}
                            onChange={(e) =>
                              setFormData({ ...formData, image: e.target.value })
                            }
                            className={errors.image ? "border-destructive" : ""}
                          />
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
                      <div className="flex items-center gap-2 mb-2">
                        <Cpu className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">
                          Step 2: Resource Allocation
                        </h3>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Required CPU Cores
                          </label>
                          <Input
                            type="number"
                            min={1}
                            max={16}
                            value={formData.cpuCores}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                cpuCores: parseInt(e.target.value) || 1,
                              })
                            }
                            className={errors.cpuCores ? "border-destructive" : ""}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Memory (GB)
                          </label>
                          <Input
                            type="number"
                            min={1}
                            max={64}
                            value={formData.memoryGB}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                memoryGB: parseInt(e.target.value) || 1,
                              })
                            }
                            className={errors.memoryGB ? "border-destructive" : ""}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Affinity Tag (Optional)
                          </label>
                          <Input
                            placeholder="e.g. gpu, high-bandwidth"
                            value={formData.affinity}
                            onChange={(e) =>
                              setFormData({ ...formData, affinity: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-mono uppercase text-muted-foreground">
                            Target Node Pinning
                          </label>
                          <Select
                            value={formData.nodeId}
                            onValueChange={(v) =>
                              setFormData({ ...formData, nodeId: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Auto-schedule (Orchestrator decision)</SelectItem>
                              {nodes.map((n) => (
                                <SelectItem key={n.id} value={n.id}>
                                  {n.name} ({n.location})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
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
                      <div className="flex items-center gap-2 mb-2">
                        <Compass className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">
                          Step 3: Review & Schedule
                        </h3>
                      </div>

                      <div className="rounded-lg bg-secondary/20 p-4 space-y-3 border border-border">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">TASK NAME:</span>
                          <span className="text-foreground font-semibold">
                            {formData.name}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">TYPE & PRIORITY:</span>
                          <span className="text-foreground font-semibold">
                            {formData.type} ({formData.priority.toUpperCase()})
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">RUNTIME:</span>
                          <span className="text-foreground font-semibold uppercase">
                            {formData.runtime}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">IMAGE:</span>
                          <span className="text-foreground font-semibold">
                            {formData.image}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">RESOURCES:</span>
                          <span className="text-foreground font-semibold">
                            {formData.cpuCores} vCPU / {formData.memoryGB} GB
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">TARGET NODE:</span>
                          <span className="text-primary font-semibold">
                            {formData.nodeId === "auto"
                              ? "Dynamic Orchestration"
                              : nodes.find((n) => n.id === formData.nodeId)?.name || "Specific Pinning"}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 bg-teal-500/5 border border-teal-500/20 rounded-lg">
                        <p className="text-[10px] text-teal-400 leading-tight italic">
                          Task will enter the global scheduler queue and execute immediately upon node selection.
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
                      disabled={submitTask.isPending}
                    >
                      Back
                    </Button>
                  ) : (
                    <div />
                  )}

                  {step < 3 ? (
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
                      disabled={submitTask.isPending}
                      className="bg-[#00d4aa] hover:bg-[#00d4aa]/90 text-[#0a0a0f]"
                    >
                      {submitTask.isPending ? "Scheduling..." : "Submit Task"}
                    </Button>
                  )}
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
