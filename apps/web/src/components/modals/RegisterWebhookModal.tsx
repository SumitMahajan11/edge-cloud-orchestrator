import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Webhook } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface RegisterWebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  initialData?: any;
}

export function RegisterWebhookModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}: RegisterWebhookModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    event: "node.status.changed",
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || "",
        url: initialData.url || "",
        event: Array.isArray(initialData.events) && initialData.events[0]
          ? initialData.events[0]
          : "node.status.changed",
      });
    } else {
      setFormData({
        name: "",
        url: "",
        event: "node.status.changed",
      });
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.url.trim()) {return;}

    onSubmit({
      ...formData,
      status: "active",
      createdAt: new Date().toISOString(),
    });

    handleClose();
  };

  const handleClose = () => {
    setFormData({
      name: "",
      url: "",
      event: "node.status.changed",
    });
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
              <div className="bg-secondary/30 px-6 py-4 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Webhook className="h-4 w-4 text-primary" />
                    </div>
                    <h2 className="text-lg font-semibold">
                      {initialData ? "Edit Webhook" : "Register Webhook"}
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
                      Webhook Name
                    </label>
                    <Input
                      placeholder="e.g. Slack Integration"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      Endpoint URL
                    </label>
                    <Input
                      type="url"
                      placeholder="https://api.example.com/webhook"
                      value={formData.url}
                      onChange={(e) =>
                        setFormData({ ...formData, url: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      Event Subscription
                    </label>
                    <Select
                      value={formData.event}
                      onValueChange={(v) =>
                        setFormData({ ...formData, event: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="node.status.changed">Node Status Changed</SelectItem>
                        <SelectItem value="task.completed">Task Completed</SelectItem>
                        <SelectItem value="task.failed">Task Failed</SelectItem>
                        <SelectItem value="alert.triggered">Alert Triggered</SelectItem>
                        <SelectItem value="*">All Events</SelectItem>
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
                    {initialData ? "Save Changes" : "Register Webhook"}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

