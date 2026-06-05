export interface TaskSubmissionInput {
  name: string;
  type: string;
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  target?: "EDGE" | "CLOUD" | "HYBRID";
  nodeId?: string;
  input?: Record<string, any>;
  metadata?: Record<string, any>;
  maxRetries?: number;
}

export interface WorkflowNode {
  id: string;
  stepName: string;
  taskSpec: TaskSubmissionInput;
  dependsOn: string[]; // IDs of nodes that must complete before this runs
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class DAGExecutor {
  /**
   * Find all nodes with no incomplete dependencies
   */
  getReadyNodes(
    nodes: WorkflowNode[],
    completedIds: Set<string>,
  ): WorkflowNode[] {
    return nodes.filter((node) => {
      // If already completed, it's not ready (it's done)
      if (completedIds.has(node.id)) return false;

      // If all dependencies are in completedIds, it's ready
      return node.dependsOn.every((depId) => completedIds.has(depId));
    });
  }

  /**
   * Validate DAG: no cycles, all dependencies exist
   */
  validate(nodes: WorkflowNode[]): ValidationResult {
    const errors: string[] = [];
    const nodeIds = new Set(nodes.map((n) => n.id));

    // 1. Check if all dependencies exist
    for (const node of nodes) {
      for (const depId of node.dependsOn) {
        if (!nodeIds.has(depId)) {
          errors.push(
            `Node "${node.stepName}" (${node.id}) depends on non-existent node "${depId}"`,
          );
        }
      }
    }

    // 2. Check for cycles using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recStack.add(nodeId);

      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        for (const depId of node.dependsOn) {
          if (hasCycle(depId)) return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (hasCycle(node.id)) {
        errors.push("DAG contains cycles");
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Topological sort for execution order visualization
   */
  topoSort(nodes: WorkflowNode[]): WorkflowNode[] {
    const result: WorkflowNode[] = [];
    const visited = new Set<string>();
    const tempVisited = new Set<string>();

    const visit = (nodeId: string) => {
      if (tempVisited.has(nodeId)) throw new Error("Cycle detected");
      if (visited.has(nodeId)) return;

      tempVisited.add(nodeId);

      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        for (const depId of node.dependsOn) {
          visit(depId);
        }
      }

      tempVisited.delete(nodeId);
      visited.add(nodeId);
      if (node) result.push(node);
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }

    return result;
  }
}
