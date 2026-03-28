import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const execAsync = promisify(exec)
const prisma = new PrismaClient()

export interface BackupOptions {
  includeDatabase: boolean
  includeFiles: boolean
  outputPath?: string
  compress?: boolean
}

export interface BackupResult {
  success: boolean
  timestamp: string
  files: string[]
  size: number
  duration: number
  error?: string
}

export class BackupManager {
  private backupDir: string
  private databaseUrl: string

  constructor(backupDir: string = './backups', databaseUrl?: string) {
    this.backupDir = backupDir
    this.databaseUrl = databaseUrl || process.env.DATABASE_URL || ''
  }

  async createBackup(options: BackupOptions = { includeDatabase: true, includeFiles: true }): Promise<BackupResult> {
    const startTime = Date.now()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(this.backupDir, `backup-${timestamp}`)
    const files: string[] = []
    let totalSize = 0

    try {
      // Create backup directory
      await fs.mkdir(backupPath, { recursive: true })

      // Database backup
      if (options.includeDatabase) {
        const dbFile = path.join(backupPath, 'database.sql')
        await this.backupDatabase(dbFile)
        files.push(dbFile)
        const stats = await fs.stat(dbFile)
        totalSize += stats.size
      }

      // File uploads backup (if any)
      if (options.includeFiles) {
        const uploadsDir = path.join(process.cwd(), 'uploads')
        try {
          await fs.access(uploadsDir)
          const uploadsBackup = path.join(backupPath, 'uploads')
          await fs.cp(uploadsDir, uploadsBackup, { recursive: true })
          files.push(uploadsBackup)
        } catch {
          // No uploads directory
        }
      }

      // Create manifest
      const manifest = {
        timestamp,
        version: '1.0.0',
        files: files.map(f => path.basename(f)),
        options,
        createdAt: new Date().toISOString(),
      }
      await fs.writeFile(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2))

      // Compress if requested
      if (options.compress) {
        const compressedFile = `${backupPath}.tar.gz`
        await execAsync(`tar -czf ${compressedFile} -C ${backupPath} .`)
        await fs.rm(backupPath, { recursive: true })
        files.length = 0
        files.push(compressedFile)
        const stats = await fs.stat(compressedFile)
        totalSize = stats.size
      }

      const duration = Date.now() - startTime

      return {
        success: true,
        timestamp,
        files,
        size: totalSize,
        duration,
      }
    } catch (error) {
      return {
        success: false,
        timestamp,
        files,
        size: totalSize,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async backupDatabase(outputFile: string): Promise<void> {
    // Parse database URL
    const url = new URL(this.databaseUrl)
    const host = url.hostname
    const port = url.port || '5432'
    const database = url.pathname.slice(1)
    const username = url.username
    const password = url.password

    // Set PGPASSWORD environment variable
    const env = { ...process.env, PGPASSWORD: password }

    // Run pg_dump
    await execAsync(
      `pg_dump -h ${host} -p ${port} -U ${username} -d ${database} -F p -f ${outputFile}`,
      { env }
    )
  }

  async restoreBackup(backupPath: string): Promise<BackupResult> {
    const startTime = Date.now()
    const timestamp = new Date().toISOString()

    try {
      // Check if backup exists
      await fs.access(backupPath)

      // Read manifest
      const manifestPath = path.join(backupPath, 'manifest.json')
      const manifestData = await fs.readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      // Restore database
      if (manifest.files.includes('database.sql')) {
        await this.restoreDatabase(path.join(backupPath, 'database.sql'))
      }

      return {
        success: true,
        timestamp,
        files: manifest.files,
        size: 0,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        timestamp,
        files: [],
        size: 0,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async restoreDatabase(sqlFile: string): Promise<void> {
    const url = new URL(this.databaseUrl)
    const host = url.hostname
    const port = url.port || '5432'
    const database = url.pathname.slice(1)
    const username = url.username
    const password = url.password

    const env = { ...process.env, PGPASSWORD: password }

    // Restore database
    await execAsync(
      `psql -h ${host} -p ${port} -U ${username} -d ${database} -f ${sqlFile}`,
      { env }
    )
  }

  async listBackups(): Promise<{ name: string; timestamp: Date; size: number }[]> {
    const backups: { name: string; timestamp: Date; size: number }[] = []

    try {
      const entries = await fs.readdir(this.backupDir)
      
      for (const entry of entries) {
        const fullPath = path.join(this.backupDir, entry)
        const stats = await fs.stat(fullPath)
        
        if (stats.isDirectory() || entry.endsWith('.tar.gz')) {
          backups.push({
            name: entry,
            timestamp: stats.birthtime,
            size: stats.size,
          })
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  async deleteBackup(name: string): Promise<boolean> {
    try {
      const backupPath = path.join(this.backupDir, name)
      const stats = await fs.stat(backupPath)
      
      if (stats.isDirectory()) {
        await fs.rm(backupPath, { recursive: true })
      } else {
        await fs.unlink(backupPath)
      }
      
      return true
    } catch {
      return false
    }
  }

  async scheduleAutomaticBackups(cronExpression: string): Promise<void> {
    // This would integrate with a job scheduler
    // For now, we'll just log the intent
    console.log(`Automatic backups scheduled with cron: ${cronExpression}`)
  }
}

// Export singleton instance
export const backupManager = new BackupManager()
