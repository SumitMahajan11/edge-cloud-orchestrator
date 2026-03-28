import { describe, it, expect, vi } from 'vitest'
import { Logger } from '../logger'

describe('Logger', () => {
  it('should log messages at or above min level', () => {
    const logger = new Logger({ minLevel: 'warn', enableStorage: true })

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    const logs = logger.getLogs()
    expect(logs.length).toBe(2) // warn and error
    expect(logs[0].level).toBe('warn')
    expect(logs[1].level).toBe('error')
  })

  it('should include context in log entries', () => {
    const logger = new Logger({ minLevel: 'info', enableStorage: true })

    logger.info('test message', { key: 'value', count: 42 })

    const logs = logger.getLogs()
    expect(logs[0].context).toEqual({ key: 'value', count: 42 })
  })

  it('should include error in error entries', () => {
    const logger = new Logger({ minLevel: 'error', enableStorage: true })
    const error = new Error('test error')

    logger.error('error occurred', error, { context: 'test' })

    const logs = logger.getLogs()
    expect(logs[0].error).toBe(error)
  })

  it('should filter logs by level', () => {
    const logger = new Logger({ minLevel: 'debug', enableStorage: true })

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')

    const errorLogs = logger.getLogs('error')
    expect(errorLogs.length).toBe(1)
    expect(errorLogs[0].level).toBe('error')
  })

  it('should limit returned logs', () => {
    const logger = new Logger({ minLevel: 'debug', enableStorage: true })

    for (let i = 0; i < 100; i++) {
      logger.info(`message ${i}`)
    }

    const logs = logger.getLogs(undefined, 10)
    expect(logs.length).toBe(10)
  })

  it('should notify subscribers', () => {
    const logger = new Logger({ minLevel: 'info' })
    const subscriber = vi.fn()

    logger.subscribe(subscriber)
    logger.info('test message')

    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      message: 'test message',
    }))
  })

  it('should unsubscribe correctly', () => {
    const logger = new Logger({ minLevel: 'info' })
    const subscriber = vi.fn()

    const unsubscribe = logger.subscribe(subscriber)
    logger.info('first')

    unsubscribe()
    logger.info('second')

    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('should clear logs', () => {
    const logger = new Logger({ minLevel: 'info', enableStorage: true })

    logger.info('message 1')
    logger.info('message 2')
    expect(logger.getLogs().length).toBe(2)

    logger.clear()
    expect(logger.getLogs().length).toBe(0)
  })

  it('should export logs as JSON', () => {
    const logger = new Logger({ minLevel: 'info', enableStorage: true })

    logger.info('message 1', { key: 'value' })
    logger.error('message 2')

    const exported = logger.export()
    const parsed = JSON.parse(exported)

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(2)
  })

  it('should limit storage entries', () => {
    const logger = new Logger({ minLevel: 'info', enableStorage: true, maxStorageEntries: 5 })

    for (let i = 0; i < 10; i++) {
      logger.info(`message ${i}`)
    }

    const logs = logger.getLogs()
    expect(logs.length).toBe(5)
    expect(logs[0].message).toBe('message 5')
  })
})
