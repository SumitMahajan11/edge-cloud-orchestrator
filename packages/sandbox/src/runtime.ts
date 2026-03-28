import { EventEmitter } from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(require('child_process').exec);

export interface SandboxConfig {
  runtime: 'firecracker' | 'gvisor' | 'docker' | 'native';
  memoryLimit: number; // MB
  cpuLimit: number; // percentage
  timeout: number; // seconds
  networkEnabled: boolean;
  diskLimit: number; // MB
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  memoryPeak: number;
  oomKilled: boolean;
}

export interface TaskExecutionRequest {
  taskId: string;
  image: string;
  command: string[];
  env: Record<string, string>;
  input?: any;
  artifacts?: string[];
}

export abstract class SandboxRuntime extends EventEmitter {
  protected config: SandboxConfig;

  constructor(config: SandboxConfig) {
    super();
    this.config = config;
  }

  abstract execute(request: TaskExecutionRequest): Promise<SandboxResult>;
  abstract isAvailable(): Promise<boolean>;
  abstract cleanup(taskId: string): Promise<void>;

  protected async createTempDir(taskId: string): Promise<string> {
    const dir = join(tmpdir(), `edgecloud-${taskId}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  protected async cleanupTempDir(dir: string): Promise<void> {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

// Firecracker MicroVM Runtime
export class FirecrackerRuntime extends SandboxRuntime {
  private firecrackerBinary: string;
  private jailerBinary: string;
  private vms: Map<string, ChildProcess> = new Map();

  constructor(config: SandboxConfig, options?: { firecrackerPath?: string; jailerPath?: string }) {
    super(config);
    this.firecrackerBinary = options?.firecrackerPath || '/usr/bin/firecracker';
    this.jailerBinary = options?.jailerPath || '/usr/bin/jailer';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`which ${this.firecrackerBinary}`);
      await execAsync(`which ${this.jailerBinary}`);
      return true;
    } catch {
      return false;
    }
  }

  async execute(request: TaskExecutionRequest): Promise<SandboxResult> {
    const startTime = Date.now();
    const workDir = await this.createTempDir(request.taskId);

    try {
      // Create Firecracker configuration
      const configPath = await this.createFirecrackerConfig(request, workDir);
      
      // Start Firecracker VM
      const vmProcess = this.startVM(request.taskId, configPath);
      this.vms.set(request.taskId, vmProcess);

      this.emit('vmStarted', { taskId: request.taskId, pid: vmProcess.pid });

      // Wait for completion or timeout
      const result = await this.waitForVM(vmProcess, this.config.timeout);
      
      const duration = Date.now() - startTime;

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration,
        memoryPeak: result.memoryPeak || this.config.memoryLimit,
        oomKilled: result.oomKilled,
      };
    } finally {
      await this.cleanup(request.taskId);
      await this.cleanupTempDir(workDir);
    }
  }

  private async createFirecrackerConfig(request: TaskExecutionRequest, workDir: string): Promise<string> {
    const config = {
      boot_source: {
        kernel_image_path: '/opt/firecracker/vmlinux',
        boot_args: 'console=ttyS0 noapic reboot=k panic=1 pci=off nomodules',
      },
      drives: [
        {
          drive_id: 'rootfs',
          path_on_host: request.image,
          is_root_device: true,
          is_read_only: false,
        },
      ],
      machine_config: {
        vcpu_count: Math.ceil(this.config.cpuLimit / 100),
        mem_size_mib: this.config.memoryLimit,
      },
      network_interfaces: this.config.networkEnabled ? [
        {
          iface_id: 'eth0',
          guest_mac: 'AA:FC:00:00:00:01',
          host_dev_name: 'tap0',
        },
      ] : [],
    };

    const configPath = join(workDir, 'config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  private startVM(taskId: string, configPath: string): ChildProcess {
    const socketPath = `/tmp/firecracker-${taskId}.sock`;
    
    return spawn(this.firecrackerBinary, [
      '--api-sock', socketPath,
      '--config-file', configPath,
    ], {
      detached: false,
    });
  }

  private async waitForVM(process: ChildProcess, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error('VM execution timeout'));
      }, timeout * 1000);

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: exitCode || 0,
          stdout,
          stderr,
          memoryPeak: 0, // Would need to query Firecracker API
          oomKilled: false,
        });
      });

      process.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  async cleanup(taskId: string): Promise<void> {
    const vm = this.vms.get(taskId);
    if (vm) {
      vm.kill('SIGTERM');
      this.vms.delete(taskId);
    }

    // Clean up socket
    try {
      await rm(`/tmp/firecracker-${taskId}.sock`, { force: true });
    } catch {
      // Ignore
    }
  }
}

// gVisor Sandbox Runtime
export class GVisorRuntime extends SandboxRuntime {
  private runscBinary: string;
  private containers: Map<string, string> = new Map();

  constructor(config: SandboxConfig, options?: { runscPath?: string }) {
    super(config);
    this.runscBinary = options?.runscPath || '/usr/local/bin/runsc';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`which ${this.runscBinary}`);
      return true;
    } catch {
      return false;
    }
  }

  async execute(request: TaskExecutionRequest): Promise<SandboxResult> {
    const startTime = Date.now();
    const containerName = `edgecloud-${request.taskId}`;
    
    try {
      // Create container
      await this.createContainer(containerName, request);
      this.containers.set(request.taskId, containerName);
      
      this.emit('containerCreated', { taskId: request.taskId, container: containerName });

      // Run container
      const result = await this.runContainer(containerName, request);
      
      const duration = Date.now() - startTime;

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration,
        memoryPeak: 0, // Would need to query cgroups
        oomKilled: result.exitCode === 137,
      };
    } finally {
      await this.cleanup(request.taskId);
    }
  }

  private async createContainer(name: string, request: TaskExecutionRequest): Promise<void> {
    const envArgs = Object.entries(request.env)
      .map(([k, v]) => `--env=${k}=${v}`)
      .join(' ');

    await execAsync(
      `${this.runscBinary} create --bundle=/var/lib/edgecloud/bundles/${request.image} ${name}`
    );
  }

  private async runContainer(name: string, request: TaskExecutionRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        try {
          await execAsync(`${this.runscBinary} kill ${name} 9`);
        } catch {
          // Ignore
        }
        reject(new Error('Container execution timeout'));
      }, this.config.timeout * 1000);

      const proc = spawn(this.runscBinary, ['run', name], {
        timeout: this.config.timeout * 1000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        resolve({ exitCode: exitCode || 0, stdout, stderr });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  async cleanup(taskId: string): Promise<void> {
    const containerName = this.containers.get(taskId);
    if (containerName) {
      try {
        await execAsync(`${this.runscBinary} delete ${containerName}`);
      } catch {
        // Ignore cleanup errors
      }
      this.containers.delete(taskId);
    }
  }
}

// Docker Runtime (fallback)
export class DockerRuntime extends SandboxRuntime {
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which docker');
      await execAsync('docker ps');
      return true;
    } catch {
      return false;
    }
  }

  async execute(request: TaskExecutionRequest): Promise<SandboxResult> {
    const startTime = Date.now();
    const containerName = `edgecloud-${request.taskId}`;

    try {
      const envArgs = Object.entries(request.env)
        .map(([k, v]) => `-e ${k}=${v}`)
        .join(' ');

      const networkArgs = this.config.networkEnabled ? '' : '--network none';

      const { stdout, stderr } = await execAsync(
        `docker run --rm --name ${containerName} ` +
        `--memory=${this.config.memoryLimit}m ` +
        `--cpus=${this.config.cpuLimit / 100} ` +
        `--storage-opt size=${this.config.diskLimit}M ` +
        `${networkArgs} ${envArgs} ${request.image} ${request.command.join(' ')}`,
        { timeout: this.config.timeout * 1000 }
      );

      return {
        exitCode: 0,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        memoryPeak: 0,
        oomKilled: false,
      };
    } catch (error: any) {
      return {
        exitCode: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        duration: Date.now() - startTime,
        memoryPeak: 0,
        oomKilled: error.stderr?.includes('OOM') || false,
      };
    }
  }

  async cleanup(taskId: string): Promise<void> {
    try {
      await execAsync(`docker rm -f edgecloud-${taskId}`);
    } catch {
      // Ignore
    }
  }
}

// Runtime factory
export class SandboxRuntimeFactory {
  static async createPreferredRuntime(config: SandboxConfig): Promise<SandboxRuntime> {
    const runtimes: Array<{ runtime: SandboxRuntime; priority: number }> = [
      { runtime: new FirecrackerRuntime(config), priority: 1 },
      { runtime: new GVisorRuntime(config), priority: 2 },
      { runtime: new DockerRuntime(config), priority: 3 },
    ];

    for (const { runtime } of runtimes.sort((a, b) => a.priority - b.priority)) {
      if (await runtime.isAvailable()) {
        return runtime;
      }
    }

    throw new Error('No sandbox runtime available');
  }
}
