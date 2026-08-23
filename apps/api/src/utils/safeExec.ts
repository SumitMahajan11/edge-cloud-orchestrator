// ============================================================================
// Secure Command Execution Layer
// ============================================================================
//
// Provides safe command execution with:
// - Command whitelisting
// - Argument validation
// - No shell injection possible
// - Timeout protection
// ============================================================================

import { spawn, type SpawnOptions } from 'child_process';

// Whitelist of allowed commands and their valid arguments
const ALLOWED_COMMANDS: Record<
  string,
  { allowedArgs: string[]; description: string }
> = {
  tar: {
    allowedArgs: ['-czf', '-C', '-xzf', '-z', '-cf', '-xf'],
    description: 'Archive utility',
  },
  docker: {
    allowedArgs: ['run', 'stop', 'ps', 'rm', 'logs', 'inspect', 'exec'],
    description: 'Container runtime',
  },
  pg_dump: {
    allowedArgs: ['-F', '-f', '-h', '-U', '-d', '--format', '--file'],
    description: 'Database backup',
  },
  gzip: {
    allowedArgs: ['-c', '-d', '-k'],
    description: 'Compression utility',
  },
  which: {
    allowedArgs: [],
    description: 'Binary location lookup',
  },
  runsc: {
    allowedArgs: ['run', 'kill', 'delete', 'list'],
    description: 'Container runtime (gVisor)',
  },
};

type AllowedCommand = keyof typeof ALLOWED_COMMANDS;

export class CommandExecutionError extends Error {
  command: string;
  args: string[];
  exitCode?: number;

  constructor(
    message: string,
    command: string,
    args: string[],
    exitCode?: number,
  ) {
    super(message);
    this.name = 'CommandExecutionError';
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
  }
}

export interface SafeExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  args: string[];
}

/**
 * Validates that an argument is safe (no shell metacharacters)
 */
function validateArg(arg: string, argIndex: number): void {
  if (typeof arg !== 'string') {
    throw new CommandExecutionError(
      `Argument at index ${argIndex} must be a string`,
      '',
      [arg],
    );
  }

  // Block shell metacharacters that could enable injection
  const dangerousPatterns = [
    ';', // Command separator
    '|', // Pipe
    '&', // Background/AND
    '$', // Variable expansion
    '`', // Command substitution
    '(',
    ')',
    '{',
    '}', // Grouping
    '<',
    '>', // Redirection
    '\n',
    '\r', // Newlines
    '\\', // Escape
    '"',
    "'", // Quotes (when unbalanced)
  ];

  for (const pattern of dangerousPatterns) {
    if (arg.includes(pattern)) {
      throw new CommandExecutionError(
        `Argument contains forbidden character '${pattern}'`,
        '',
        [arg],
      );
    }
  }

  // Block path traversal attempts
  if (arg.includes('..') && arg.startsWith('/')) {
    throw new CommandExecutionError(
      'Absolute path traversal is forbidden',
      '',
      [arg],
    );
  }
}

/**
 * Validates command and arguments against whitelist
 */
function validateCommand(command: string, args: string[]): void {
  // Check if command is allowed
  const allowedCommand = ALLOWED_COMMANDS[command as AllowedCommand];

  if (!allowedCommand) {
    throw new CommandExecutionError(
      `Command not allowed: ${command}. Allowed commands: ${Object.keys(ALLOWED_COMMANDS).join(', ')}`,
      command,
      args,
    );
  }

  // Validate each argument
  args.forEach((arg, index) => {
    validateArg(arg, index);

    // If command has specific allowed args, validate against whitelist
    if (allowedCommand.allowedArgs.length > 0) {
      // Extract base argument (without value)
      const baseArg = arg.split('=').find((a) => a !== '') || arg;

      if (!allowedCommand.allowedArgs.includes(baseArg)) {
        // Check if it's a value for a known argument
        const prevArg = args[index - 1];
        const isValue = prevArg && allowedCommand.allowedArgs.includes(prevArg);

        if (!isValue && !baseArg.startsWith('/')) {
          throw new CommandExecutionError(
            `Argument '${baseArg}' not allowed for command '${command}'. Allowed: ${allowedCommand.allowedArgs.join(', ')}`,
            command,
            args,
          );
        }
      }
    }
  });
}

/**
 * Safely execute a command with validation and timeout protection
 *
 * @param command - Command to execute (must be whitelisted)
 * @param args - Command arguments (validated)
 * @param options - Spawn options
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns Promise with stdout, stderr, and exit code
 *
 * @example
 * ```typescript
 * // Safe usage
 * const result = await safeExec('tar', ['-czf', 'backup.tar.gz', '-C', '/backups', '.']);
 *
 * // Will throw error
 * await safeExec('rm', ['-rf', '/']); // ❌ Command not allowed
 * await safeExec('tar', ['-czf', 'file; rm -rf / #']); // ❌ Shell metacharacter
 * ```
 */
export async function safeExec(
  command: string,
  args: string[],
  options: SpawnOptions = {},
  timeoutMs: number = 30000,
): Promise<SafeExecResult> {
  // Validate command and arguments BEFORE execution
  validateCommand(command, args);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    // Set up spawn with shell disabled (CRITICAL SECURITY)
    const proc = spawn(command, args, {
      ...options,
      shell: false, // NEVER use shell
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Timeout protection
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');

        // Force kill after grace period
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch (e) {
            // Process already dead
          }
        }, 5000);

        reject(
          new CommandExecutionError(
            `Command timed out after ${timeoutMs}ms`,
            command,
            args,
          ),
        );
      }
    }, timeoutMs);

    // Capture output
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle completion
    proc.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
          command,
          args,
        });
      } else {
        reject(
          new CommandExecutionError(
            `Command failed with exit code ${code}: ${stderr.trim()}`,
            command,
            args,
            code ?? undefined,
          ),
        );
      }
    });

    // Handle spawn errors
    proc.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(
          new CommandExecutionError(
            `Failed to spawn command: ${error.message}`,
            command,
            args,
          ),
        );
      }
    });
  });
}
