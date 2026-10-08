-- Add optional GPU capabilities to edge nodes and an explicit GPU requirement to tasks.
ALTER TABLE "edge_nodes"
  ADD COLUMN "gpuModel" TEXT,
  ADD COLUMN "gpuMemoryMb" INTEGER;

ALTER TABLE "tasks"
  ADD COLUMN "requiresGpu" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "edge_nodes_gpuModel_idx" ON "edge_nodes"("gpuModel");
CREATE INDEX "tasks_requiresGpu_status_idx" ON "tasks"("requiresGpu", "status");
