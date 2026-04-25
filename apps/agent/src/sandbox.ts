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

    // Calculate timeout from payload (default 1 hour)
    const maxDurationSeconds = payload.maxDurationSeconds || 3600;
    const timeoutMs = maxDurationSeconds * 1000;
    let timeoutTimer: NodeJS.Timeout | null = null;

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

      // 5. Start container
      await container.start();
      
      // 6. Set up timeout enforcement
      const timeoutPromise = new Promise<ExecutionResult>((_, reject) => {
        timeoutTimer = setTimeout(async () => {
          logger.warn(`Task ${payload.taskId} exceeded max duration (${maxDurationSeconds}s), sending SIGTERM`);
          try {
            // Send SIGTERM first (grace period)
            await container!.kill({ signal: 'SIGTERM' });
            
            // Wait 15 seconds for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            // Force kill if still running
            logger.warn(`Task ${payload.taskId} did not stop after SIGTERM, sending SIGKILL`);
            await container!.kill({ signal: 'SIGKILL' });
          } catch (err) {
            logger.error(`Failed to kill container for task ${payload.taskId}:`, err);
          }
          
          reject(new Error(`Task exceeded max duration: ${maxDurationSeconds}s`));
        }, timeoutMs);
      });

      // 7. Monitor container with timeout
      const executionPromise = (async (): Promise<ExecutionResult> => {
        const stream = await container!.logs({ stdout: true, stderr: true, follow: true });
        let stdout = '', stderr = '';
        
        // Demux logs (Dockerode logs stream is multiplexed)
        this.docker.modem.demuxStream(stream, {
          write: (chunk: Buffer) => stdout += chunk.toString(),
        } as any, {
          write: (chunk: Buffer) => stderr += chunk.toString(),
        } as any);

        const waitResult = await container!.wait();
        
        return {
          taskId: payload.taskId,
          status: waitResult.StatusCode === 0 ? 'completed' : 'failed',
          exitCode: waitResult.StatusCode,
          stdout: stdout.substring(0, 5000), // Limit output size
          stderr: stderr.substring(0, 5000),
          executionTime: Date.now() - startTime
        };
      })();

      // Race between execution and timeout
      const result = await Promise.race([executionPromise, timeoutPromise]);
      return result;

    } catch (err: any) {
      // Check if this is a timeout error (SIGKILL exit code 137)
      const isTimeout = err.message.includes('exceeded max duration') || err.statusCode === 137;
      
      logger.error(`Task ${payload.taskId} failed:`, err);
      return {
        taskId: payload.taskId,
        status: isTimeout ? 'timeout' : 'failed',
        error: err.message,
        exitCode: isTimeout ? 137 : undefined,
        executionTime: Date.now() - startTime
      };
    } finally {
      // Clean up timeout timer if still active
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    }
  }

  private async pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, {}, (err, stream) => {
        if (err) return reject(err);
        if (!stream) return reject(new Error('Failed to create pull stream'));
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
