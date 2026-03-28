/**
 * Kubernetes Operator for Edge-Cloud Orchestrator
 * Manages EdgeNode custom resources
 */

import { KubernetesObjectApi, CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node'

// Custom Resource Definition for EdgeNode
export const EDGE_NODE_CRD = {
  apiVersion: 'apiextensions.k8s.io/v1',
  kind: 'CustomResourceDefinition',
  metadata: {
    name: 'edgenodes.edge-cloud.io',
  },
  spec: {
    group: 'edge-cloud.io',
    versions: [
      {
        name: 'v1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  region: { type: 'string' },
                  location: { type: 'string' },
                  cpuCores: { type: 'integer' },
                  memoryGB: { type: 'integer' },
                  storageGB: { type: 'integer' },
                  maxTasks: { type: 'integer' },
                  costPerHour: { type: 'number' },
                },
                required: ['region', 'location'],
              },
              status: {
                type: 'object',
                properties: {
                  phase: { type: 'string' },
                  conditions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        status: { type: 'string' },
                        lastTransitionTime: { type: 'string' },
                        reason: { type: 'string' },
                        message: { type: 'string' },
                      },
                    },
                  },
                  cpuUsage: { type: 'number' },
                  memoryUsage: { type: 'number' },
                  tasksRunning: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    ],
    scope: 'Namespaced',
    names: {
      plural: 'edgenodes',
      singular: 'edgenode',
      kind: 'EdgeNode',
      shortNames: ['en'],
    },
  },
}

export interface EdgeNodeResource {
  apiVersion: 'edge-cloud.io/v1'
  kind: 'EdgeNode'
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec: {
    region: string
    location: string
    cpuCores?: number
    memoryGB?: number
    storageGB?: number
    maxTasks?: number
    costPerHour?: number
  }
  status?: {
    phase: string
    conditions: Array<{
      type: string
      status: string
      lastTransitionTime: string
      reason: string
      message: string
    }>
    cpuUsage?: number
    memoryUsage?: number
    tasksRunning?: number
  }
}

export class EdgeCloudOperator {
  private kc: KubeConfig
  private customApi: CustomObjectsApi
  private coreApi: CoreV1Api
  private namespace: string

  constructor(namespace: string = 'edge-cloud-orchestrator') {
    this.kc = new KubeConfig()
    this.kc.loadFromDefault()
    
    this.customApi = this.kc.makeApiClient(CustomObjectsApi)
    this.coreApi = this.kc.makeApiClient(CoreV1Api)
    this.namespace = namespace
  }

  /**
   * Install CRDs to the cluster
   */
  async installCRDs(): Promise<void> {
    const api = this.kc.makeApiClient(KubernetesObjectApi)
    await api.create(EDGE_NODE_CRD as any)
    console.log('✅ EdgeNode CRD installed')
  }

  /**
   * Create an EdgeNode resource
   */
  async createEdgeNode(node: Omit<EdgeNodeResource, 'apiVersion' | 'kind'>): Promise<EdgeNodeResource> {
    const resource: EdgeNodeResource = {
      apiVersion: 'edge-cloud.io/v1',
      kind: 'EdgeNode',
      ...node,
    }

    const response = await (this.customApi as any).createNamespacedCustomObject(
      'edge-cloud.io',
      'v1',
      this.namespace,
      'edgenodes',
      resource
    )

    return response.body as EdgeNodeResource
  }

  /**
   * Get an EdgeNode by name
   */
  async getEdgeNode(name: string): Promise<EdgeNodeResource | null> {
    try {
      const response = await (this.customApi as any).getNamespacedCustomObject(
        'edge-cloud.io',
        'v1',
        this.namespace,
        'edgenodes',
        name
      )
      return response.body as EdgeNodeResource
    } catch {
      return null
    }
  }

  /**
   * List all EdgeNodes
   */
  async listEdgeNodes(): Promise<EdgeNodeResource[]> {
    const response = await (this.customApi as any).listNamespacedCustomObject(
      'edge-cloud.io',
      'v1',
      this.namespace,
      'edgenodes'
    )
    return (response.body as any).items as EdgeNodeResource[]
  }

  /**
   * Update EdgeNode status
   */
  async updateEdgeNodeStatus(
    name: string,
    status: EdgeNodeResource['status']
  ): Promise<EdgeNodeResource> {
    const node = await this.getEdgeNode(name)
    if (!node) {
      throw new Error(`EdgeNode ${name} not found`)
    }

    const response = await (this.customApi as any).patchNamespacedCustomObjectStatus(
      'edge-cloud.io',
      'v1',
      this.namespace,
      'edgenodes',
      name,
      { status }
    )

    return response.body as EdgeNodeResource
  }

  /**
   * Delete an EdgeNode
   */
  async deleteEdgeNode(name: string): Promise<void> {
    await (this.customApi as any).deleteNamespacedCustomObject(
      'edge-cloud.io',
      'v1',
      this.namespace,
      'edgenodes',
      name
    )
  }

  /**
   * Scale backend deployment
   */
  async scaleBackend(replicas: number): Promise<void> {
    const patch = {
      spec: {
        replicas,
      },
    }

    await (this.coreApi as any).patchNamespacedDeployment(
      'backend',
      this.namespace,
      patch
    )
  }

  /**
   * Get cluster nodes
   */
  async getClusterNodes(): Promise<any[]> {
    const response = await this.coreApi.listNode()
    return (response as any).body.items
  }

  /**
   * Watch for EdgeNode changes
   */
  watchEdgeNodes(callback: (event: string, node: EdgeNodeResource) => void): void {
    const watch = new (require('@kubernetes/client-node').Watch)(this.kc)
    
    watch.watch(
      `/apis/edge-cloud.io/v1/namespaces/${this.namespace}/edgenodes`,
      {},
      (type: string, obj: any) => {
        callback(type, obj as EdgeNodeResource)
      },
      (err: Error) => {
        console.error('Watch error:', err)
      }
    )
  }
}
