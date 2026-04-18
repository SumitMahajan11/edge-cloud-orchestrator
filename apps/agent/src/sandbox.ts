import Docker from 'dockerode';
import { AgentConfig, TaskPayload, ExecutionResult } from './types';
import pino from 'pino';

const logger = pino({ name: 'edge-agent-sandbox' });

export class DockerSandbox {
  private docker: Docker;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    
    const dockerOptions: Docker.DockerOptions = {};
    if (config.DOCKER_HOST) {
      dockerOptions.host = config.DOCKER_HOST;
      if (config.DOCKER_TLS_CA) {
        dockerOptions.ca = config.DOCKER_TLS_CA;
        dockerOptions.cert = config.DOCKER_TLS_CERT;
        dockerOptions.key = config.DOCKER_TLS_KEY;
      }
    } else {
      dockerOptions.socketPath = '/var/run/docker.sock';
    }

    this.docker = new Docker(dockerOptions);
  }

  async runTask(payload: TaskPayload): Promise<ExecutionResult> {
    const startTime = Date.now();
    let container: Docker.Container | undefined;

    try {
      // 1. Pull image if not local
      await this.pullImage(payload.image);

      // 2. Prepare environment and commands
      const Env = payload.env ? Object.entries(payload.env).map(([k, v]) => `${k}=${v}`) : [];
      const Cmd = Array.isArray(payload.command) ? payload.command : (payload.command ? [payload.command] : undefined);

      // 3. Configure production-hardened HostConfig
      // Memory is in bytes
      const memoryLimit = this.parseMemory(payload.resources?.memory || '512m');
      // CPU Quota is in microseconds. period is 100,000 by default. 0.5 CPU = 50,000
      const cpuQuota = (payload.resources?.cpu || 0.5) * 100000;

      const hostConfig: Docker.HostConfig = {
        Memory: memoryLimit,
        CpuQuota: cpuQuota,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges'],
        NetworkMode: payload.network || 'none',
        CapDrop: ['ALL'],
        AutoRemove: true,
      };

      // 4. Create container
      container = await this.docker.createContainer({
        Image: payload.image,
        Cmd,
        Env,
        HostConfig: hostConfig,
        Labels: {
          'edgecloud.task_id': payload.taskId,
          'edgecloud.managed': 'true'
        }
      });

      // 5. Start and wait
      await container.start();
      
      const stream = await container.logs({ stdout: true, stderr: true, follow: true });
      let stdout = '', stderr = '';
      
      // Demux logs (Dockerode logs stream is multiplexed)
      this.docker.modem.demuxStream(stream, {
        write: (chunk: Buffer) => stdout += chunk.toString(),
      } as any, {
        write: (chunk: Buffer) => stderr += chunk.toString(),
      } as any);

      const waitResult = await container.wait();
      
      return {
        taskId: payload.taskId,
        status: waitResult.StatusCode === 0 ? 'completed' : 'failed',
        exitCode: waitResult.StatusCode,
        stdout: stdout.substring(0, 5000), // Limit output size
        stderr: stderr.substring(0, 5000),
        executionTime: Date.now() - startTime
      };

    } catch (err: any) {
      logger.error(`Task ${payload.taskId} failed:`, err);
      return {
        taskId: payload.taskId,
        status: 'failed',
        error: err.message,
        executionTime: Date.now() - startTime
      };
    }
  }

  private async pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, {}, (err, stream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  private parseMemory(mem: string): number {
    const units: Record<string, number> = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    const match = mem.toLowerCase().match(/^(\d+)([kmg])?$/);
    if (!match) return 512 * 1024 * 1024;
    const value = parseInt(match[1], 10);
    const multiplier = match[2] ? units[match[2]] : 1;
    return value * multiplier;
  }
}
