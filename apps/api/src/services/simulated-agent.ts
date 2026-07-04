import axios from 'axios';
import jwt from 'jsonwebtoken';
import { createLogger } from '@edgecloud/shared-kernel';
import { env } from '../config/env';

const logger = createLogger('simulated-agent');

export class SimulatedAgent {
  private interval: NodeJS.Timeout | null = null;
  private nodeIds: string[] = [];
  private nodesConfig = [
    {
      name: 'edge-sim-01',
      location: 'New York, USA',
      region: 'us-east',
      ipAddress: '93.184.216.34', // Public IP to pass SSRF check
      port: 5001,
      cpuCores: 4,
      memoryGB: 16,
      storageGB: 100,
    },
    {
      name: 'edge-sim-02',
      location: 'Dublin, Ireland',
      region: 'eu-west',
      ipAddress: '8.8.8.8', // Public IP to pass SSRF check
      port: 5001,
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 200,
    },
    {
      name: 'edge-sim-03',
      location: 'Singapore',
      region: 'ap-southeast',
      ipAddress: '1.1.1.1', // Public IP to pass SSRF check
      port: 5001,
      cpuCores: 2,
      memoryGB: 8,
      storageGB: 50,
    },
  ];

  async start() {
    logger.info('Starting simulated agent service...');

    // 1. Generate a long-lived JWT Token for the service to authenticate
    const token = jwt.sign(
      {
        id: '0caec6c7-a5cd-4546-a573-eee72d84f199',
        email: 'admin@demo-org.com',
        role: 'ADMIN',
        tenantId: 'b82c03e7-6144-4fc4-825e-cde3fcaf8a50',
        permissions: ['*'],
      },
      env.JWT_SECRET,
      {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        expiresIn: '10y',
      }
    );

    const authHeaders = {
      Authorization: `Bearer ${token}`,
    };

    const baseUrl = `http://127.0.0.1:${env.PORT}`;

    // 2. Register nodes or retrieve IDs if they already exist
    const runId = Math.random().toString(36).substring(7);
    for (const nodeConfig of this.nodesConfig) {
      const nodeName = `${nodeConfig.name}-${runId}`;
      try {
        logger.info(`Registering simulated node: ${nodeName}...`);
        const response = await axios.post(`${baseUrl}/v2/nodes`, { ...nodeConfig, name: nodeName }, {
          headers: authHeaders,
        });
        const nodeId = response.data.id;
        this.nodeIds.push(nodeId);
        logger.info(`Node ${nodeName} registered successfully with ID: ${nodeId}`);
      } catch (err: any) {
        if (err.response?.status === 409) {
          logger.info(`Node ${nodeName} already exists. Retrieving ID...`);
          try {
            const listResponse = await axios.get(`${baseUrl}/v2/nodes`, {
              headers: authHeaders,
              params: { limit: 100 },
            });
            const existingNode = listResponse.data.data.find(
              (n: any) => n.name === nodeName
            );
            if (existingNode) {
              this.nodeIds.push(existingNode.id);
              logger.info(`Found existing node ${nodeName} with ID: ${existingNode.id}`);
            } else {
              logger.error(`Node conflict reported, but ${nodeName} not found in nodes list.`);
            }
          } catch (listErr: any) {
            logger.error(`Failed to retrieve nodes list: ${listErr.message}`);
          }
        } else {
          logger.error(`Failed to register node ${nodeName}: ${err.response?.data?.error?.message || err.message}`);
        }
      }
    }

    // 3. Periodic heartbeats
    this.interval = setInterval(async () => {
      for (const nodeId of this.nodeIds) {
        try {
          const cpuUsage = Math.round((20 + Math.random() * 40) * 100) / 100;
          const memoryUsage = Math.round((40 + Math.random() * 30) * 100) / 100;
          const storageUsage = Math.round((10 + Math.random() * 20) * 100) / 100;

          await axios.post(
            `${baseUrl}/v2/nodes/${nodeId}/heartbeat`,
            {
              cpuUsage,
              memoryUsage,
              storageUsage,
              latency: Math.round((5 + Math.random() * 15) * 100) / 100,
              tasksRunning: 0,
            },
            {
              headers: authHeaders,
            }
          );
          logger.debug(`Broadcasted heartbeat for simulated node ${nodeId} successfully.`);
        } catch (err: any) {
          logger.error(`Heartbeat failed for simulated node ${nodeId}: ${err.response?.data?.error?.message || err.message}`);
        }
      }
    }, 10000); // 10 seconds interval
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Stopped simulated agent service.');
    }
  }
}
