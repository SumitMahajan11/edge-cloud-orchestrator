import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Network, Link as LinkIcon, Settings } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";

interface CreateWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

export function CreateWorkflowModal({ isOpen, onClose, onSubmit }: CreateWorkflowModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    trigger: "manual",
    description: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {return;}

    onSubmit({
      name: formData.name.trim(),
      version: "1.0.0",
      nodes: [
        {
          id: "step-1",
          name: `${formData.name.trim()  } Initial Step`,
          type: "task",
          config: { trigger: formData.trigger, description: formData.description },
          inputs: [],
          outputs: ["out-1"],
        },
      ],
      edges: [],
      variables: {},
    });

    handleClose();
  };

  const handleClose = () => {
    setFormData({
      name: "",
      trigger: "manual",
      description: "",
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="create-workflow-modal-wrapper"
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
                      <Network className="h-4 w-4 text-primary" />
                    </div>
                    <h2 className="text-lg font-semibold">Create Workflow</h2>
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
                      Workflow Name
                    </label>
                    <Input
                      placeholder="e.g. data-processing-pipeline"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      Description (Optional)
                    </label>
                    <Input
                      placeholder="Describe what this workflow does"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({ ...formData, description: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      Trigger Type
                    </label>
                    <Select
                      value={formData.trigger}
                      onValueChange={(v) =>
                        setFormData({ ...formData, trigger: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual Trigger</SelectItem>
                        <SelectItem value="schedule">Scheduled (Cron)</SelectItem>
                        <SelectItem value="webhook">Webhook Request</SelectItem>
                        <SelectItem value="event">System Event</SelectItem>
                      </SelectContent>
                    </Select>
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
                    Create Workflow
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
