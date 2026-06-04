import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { setupTestApp, teardownTestApp, TestContext } from './helpers'

describe('WebSocket Consolidated Hub Integration', () => {
  let ctx: TestContext

  beforeAll(async () => {
    console.log('[Test] Setting up test app...')
    ctx = await setupTestApp()
    console.log('[Test] App setup complete. Waiting for ready...')
    await ctx.app.ready()
    console.log('[Test] App ready. Starting listener...')
    const addr = await ctx.app.listen({ port: 0, host: '127.0.0.1' })
    console.log(`[Test] App listening at ${addr}`)
  }, 30000)

  afterAll(async () => {
    if (ctx) {
      console.log('[Test] Tearing down test app...')
      await teardownTestApp(ctx)
    }
  })

  it('should be alive', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health'
    })
    console.log('[Test] Health check status:', res.statusCode)
    expect(res.statusCode).toBe(200)
  })

  it('should connect to /ws and authenticate via query param', async () => {
    const address = ctx.app.server.address() as any
    const url = `ws://127.0.0.1:${address.port}/ws?token=${ctx.accessToken}`
    console.log(`[Test] Connecting to ${url}`)
    
    const ws = new WebSocket(url)
    
    const messagePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[Test] Timeout waiting for connected message')
        ws.terminate()
        reject(new Error('Timeout waiting for connected'))
      }, 15000)

      ws.on('open', () => {
        console.log('[Test] WS Connection Opened')
      })

      ws.on('message', (data) => {
        const str = data.toString();
        console.log(`[Test] Received message: ${str}`)
        try {
          const msg = JSON.parse(str)
          if (msg.type === 'connected') {
            clearTimeout(timeout)
            resolve(msg)
          }
        } catch (e) {
          console.error('[Test] Failed to parse message:', str)
        }
      })

      ws.on('error', (err) => {
        console.error('[Test] WS Error Event:', err)
        clearTimeout(timeout)
        reject(err)
      })

      ws.on('close', (code, reason) => {
        console.log(`[Test] WS Closed Event: Code=${code}, Reason=${reason}`)
      })
    })

    const connected = await messagePromise as any
    expect(connected.type).toBe('connected')
    expect(connected.payload.clientId).toBeDefined()
    
    ws.close()
  }, 20000)

  it('should receive initial snapshot on subscribe', async () => {
    const address = ctx.app.server.address() as any
    const url = `ws://127.0.0.1:${address.port}/ws?token=${ctx.accessToken}`
    
    // Create a node first to have something in the snapshot
    await ctx.prisma.edgeNode.upsert({
      where: { id: 'node-ws-test' },
      update: { status: 'ONLINE' },
      create: {
        id: 'node-ws-test',
        name: 'WS Test Node',
        status: 'ONLINE',
        tenantId: ctx.tenantId,
        region: 'us-east',
        ipAddress: '1.2.3.4',
        location: 'Test Location',
        port: 4001,
        url: 'http://1.2.3.4:4001',
        cpuCores: 1,
        memoryGB: 1,
        storageGB: 1
      }
    })

    const ws = new WebSocket(url)
    
    const snapshotPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for snapshot')), 15000)
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        console.log('[Test] Received message in snapshot test:', msg.type, msg.payload?.channel)
        if (msg.type === 'snapshot' && (msg.payload?.channel === 'nodes' || msg.payload?.channel === `node:nodes:${ctx.tenantId}`)) {
          clearTimeout(timeout)
          resolve(msg)
        }
      })
      ws.on('error', reject)
    })

    ws.on('open', () => {
      // Subscribe to nodes
      ws.send(JSON.stringify({
        type: 'subscribe',
        payload: { channels: [`node:nodes:${ctx.tenantId}`] }
      }))
    })

    const snapshot = await snapshotPromise as any
    expect(snapshot.payload.data).toBeInstanceOf(Array)
    expect(snapshot.payload.data.some((n: any) => n.id === 'node-ws-test')).toBe(true)
    
    ws.close()
  }, 20000)

  it('should resume session on reconnection', async () => {
    const address = ctx.app.server.address() as any
    const url = `ws://127.0.0.1:${address.port}/ws?token=${ctx.accessToken}`
    
    // 1. Connect and subscribe
    const ws1 = new WebSocket(url)
    let clientId: string = ''
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout in ws1 setup')), 15000)
      ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'connected') {
          clientId = msg.payload.clientId
          ws1.send(JSON.stringify({ type: 'subscribe', payload: { channels: ['tasks'] } }))
          clearTimeout(timeout)
          resolve()
        }
      })
      ws1.on('error', reject)
    })
    
    ws1.close()
    
    // Wait a bit for the manager to move client to disconnectedClients
    await new Promise((r) => setTimeout(r, 1000))
    
    // 2. Reconnect and send reconnect message
    const ws2 = new WebSocket(url)
    const resumedPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout in reconnection')), 15000)
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'reconnected') {
          clearTimeout(timeout)
          resolve(msg)
        }
      })
      ws2.on('error', reject)
    })
    
    ws2.on('open', () => {
      ws2.send(JSON.stringify({
        type: 'reconnect',
        payload: { previousConnectionId: clientId }
      }))
    })
    
    const resumed = await resumedPromise as any
    expect(resumed.type).toBe('reconnected')
    
    ws2.close()
  }, 20000)
})
