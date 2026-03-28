/**
 * Raft Consensus Implementation for Distributed Edge-Cloud Orchestrator
 * Implements leader election, log replication, and fault tolerance
 */

type RaftState = 'follower' | 'candidate' | 'leader'

interface LogEntry {
  term: number
  index: number
  command: RaftCommand
  timestamp: number
}

interface RaftCommand {
  type: 'schedule_task' | 'update_node' | 'change_policy' | 'add_node' | 'remove_node'
  data: unknown
}

interface RaftConfig {
  nodeId: string
  peers: string[]
  heartbeatInterval?: number
  electionTimeoutMin?: number
  electionTimeoutMax?: number
  rpcTimeout?: number
}

interface RequestVoteRequest {
  term: number
  candidateId: string
  lastLogIndex: number
  lastLogTerm: number
}

interface RequestVoteResponse {
  term: number
  voteGranted: boolean
}

interface AppendEntriesRequest {
  term: number
  leaderId: string
  prevLogIndex: number
  prevLogTerm: number
  entries: LogEntry[]
  leaderCommit: number
}

interface AppendEntriesResponse {
  term: number
  success: boolean
  matchIndex: number
}

interface RaftMetrics {
  state: RaftState
  currentTerm: number
  commitIndex: number
  lastApplied: number
  logLength: number
  leaderId: string | null
  votesReceived: number
  peers: number
}

type RaftEvent = 'state_change' | 'leader_elected' | 'log_committed' | 'term_change'
type RaftCallback = (event: RaftEvent, data: unknown) => void

const DEFAULT_CONFIG = {
  heartbeatInterval: 1000,      // 1 second
  electionTimeoutMin: 3000,     // 3 seconds
  electionTimeoutMax: 6000,     // 6 seconds
  rpcTimeout: 500,              // 500ms
}

export class RaftConsensus {
  private nodeId: string
  private peers: string[]
  private config: Required<Omit<RaftConfig, 'nodeId' | 'pees'>> & Pick<RaftConfig, 'nodeId' | 'peers'>

  // Persistent state
  private currentTerm = 0
  private votedFor: string | null = null
  private log: LogEntry[] = []

  // Volatile state
  private commitIndex = 0
  private lastApplied = 0
  private state: RaftState = 'follower'
  private leaderId: string | null = null

  // Leader state
  private nextIndex: Map<string, number> = new Map()
  private matchIndex: Map<string, number> = new Map()

  // Candidate state
  private votesReceived = 0

  // Timers
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private electionTimer: ReturnType<typeof setTimeout> | null = null

  // Event handlers
  private callbacks: Map<RaftEvent, Set<RaftCallback>> = new Map()

  // State machine
  private stateMachine: Map<string, unknown> = new Map()

  constructor(config: RaftConfig) {
    this.nodeId = config.nodeId
    this.peers = config.peers
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<RaftConfig>

    this.resetElectionTimer()
  }

  /**
   * Start the Raft node
   */
  start(): void {
    this.resetElectionTimer()
    console.log(`[Raft] Node ${this.nodeId} started as ${this.state}`)
  }

  /**
   * Stop the Raft node
   */
  stop(): void {
    this.clearTimers()
    console.log(`[Raft] Node ${this.nodeId} stopped`)
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.electionTimer) {
      clearTimeout(this.electionTimer)
      this.electionTimer = null
    }
  }

  private resetElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer)
    }

    const timeout = this.randomElectionTimeout()
    this.electionTimer = setTimeout(() => {
      this.startElection()
    }, timeout)
  }

  private randomElectionTimeout(): number {
    const { electionTimeoutMin, electionTimeoutMax } = this.config
    return Math.floor(Math.random() * (electionTimeoutMax - electionTimeoutMin) + electionTimeoutMin)
  }

  /**
   * Start an election
   */
  private startElection(): void {
    const previousState = this.state
    this.state = 'candidate'
    this.currentTerm++
    this.votedFor = this.nodeId
    this.votesReceived = 1 // Vote for self
    this.leaderId = null

    this.emit('state_change', { from: previousState, to: 'candidate', term: this.currentTerm })

    console.log(`[Raft] Node ${this.nodeId} starting election for term ${this.currentTerm}`)

    // Request votes from all peers
    const lastLogIndex = this.log.length - 1
    const lastLogTerm = this.log.length > 0 ? this.log[this.log.length - 1].term : 0

    const request: RequestVoteRequest = {
      term: this.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex,
      lastLogTerm,
    }

    // Simulate sending RequestVote to peers (in real impl, use HTTP/WebSocket)
    this.peers.forEach(peerId => {
      this.sendRequestVote(peerId, request)
    })

    // Reset election timer
    this.resetElectionTimer()
  }

  /**
   * Send RequestVote RPC to a peer (simulated)
   */
  private async sendRequestVote(peerId: string, request: RequestVoteRequest): Promise<void> {
    try {
      // In real implementation, this would be an HTTP/WebSocket call
      const response = await this.simulateRequestVote(peerId, request)
      this.handleRequestVoteResponse(response)
    } catch (error) {
      console.error(`[Raft] RequestVote to ${peerId} failed:`, error)
    }
  }

  /**
   * Simulate RequestVote (would be real RPC in production)
   */
  private async simulateRequestVote(_peerId: string, request: RequestVoteRequest): Promise<RequestVoteResponse> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100))

    // Simulate peer response (simplified - in real impl, this would be the peer's actual logic)
    const grantVote = Math.random() > 0.3 // 70% chance of granting vote

    return {
      term: request.term,
      voteGranted: grantVote,
    }
  }

  /**
   * Handle RequestVote response
   */
  private handleRequestVoteResponse(response: RequestVoteResponse): void {
    if (this.state !== 'candidate') return

    if (response.term > this.currentTerm) {
      // Discovered higher term, convert to follower
      this.currentTerm = response.term
      this.becomeFollower(response.term, null)
      return
    }

    if (response.voteGranted) {
      this.votesReceived++
      
      // Check if we have majority
      const majority = Math.floor((this.peers.length + 1) / 2) + 1
      if (this.votesReceived >= majority) {
        this.becomeLeader()
      }
    }
  }

  /**
   * Become the leader
   */
  private becomeLeader(): void {
    const previousState = this.state
    this.state = 'leader'
    this.leaderId = this.nodeId

    // Initialize leader state
    const lastLogIndex = this.log.length - 1
    this.peers.forEach(peerId => {
      this.nextIndex.set(peerId, lastLogIndex + 1)
      this.matchIndex.set(peerId, 0)
    })

    this.emit('state_change', { from: previousState, to: 'leader', term: this.currentTerm })
    this.emit('leader_elected', { leaderId: this.nodeId, term: this.currentTerm })

    console.log(`[Raft] Node ${this.nodeId} became leader for term ${this.currentTerm}`)

    // Start sending heartbeats
    this.startHeartbeats()
  }

  /**
   * Become a follower
   */
  private becomeFollower(term: number, leaderId: string | null): void {
    const previousState = this.state
    this.state = 'follower'
    this.currentTerm = term
    this.leaderId = leaderId
    this.votedFor = null

    this.emit('state_change', { from: previousState, to: 'follower', term })

    // Stop heartbeats if we were leader
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    this.resetElectionTimer()
  }

  /**
   * Start sending heartbeats (leader only)
   */
  private startHeartbeats(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats()
    }, this.config.heartbeatInterval)
  }

  /**
   * Send heartbeats to all peers
   */
  private sendHeartbeats(): void {
    if (this.state !== 'leader') return

    this.peers.forEach(peerId => {
      const nextIndex = this.nextIndex.get(peerId) || 0
      const prevLogIndex = nextIndex - 1
      const prevLogTerm = prevLogIndex >= 0 ? this.log[prevLogIndex].term : 0

      const entries = this.log.slice(nextIndex)

      const request: AppendEntriesRequest = {
        term: this.currentTerm,
        leaderId: this.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.commitIndex,
      }

      this.sendAppendEntries(peerId, request)
    })
  }

  /**
   * Send AppendEntries RPC to a peer
   */
  private async sendAppendEntries(peerId: string, request: AppendEntriesRequest): Promise<void> {
    try {
      const response = await this.simulateAppendEntries(peerId, request)
      this.handleAppendEntriesResponse(peerId, response)
    } catch (error) {
      console.error(`[Raft] AppendEntries to ${peerId} failed:`, error)
    }
  }

  /**
   * Simulate AppendEntries (would be real RPC in production)
   */
  private async simulateAppendEntries(_peerId: string, request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50))

    return {
      term: request.term,
      success: Math.random() > 0.1, // 90% success rate
      matchIndex: request.prevLogIndex + request.entries.length,
    }
  }

  /**
   * Handle AppendEntries response
   */
  private handleAppendEntriesResponse(peerId: string, response: AppendEntriesResponse): void {
    if (this.state !== 'leader') return

    if (response.term > this.currentTerm) {
      this.becomeFollower(response.term, null)
      return
    }

    if (response.success) {
      this.matchIndex.set(peerId, response.matchIndex)
      this.nextIndex.set(peerId, response.matchIndex + 1)

      // Check if we can commit
      this.updateCommitIndex()
    } else {
      // Decrement nextIndex and retry
      const current = this.nextIndex.get(peerId) || 1
      this.nextIndex.set(peerId, Math.max(0, current - 1))
    }
  }

  /**
   * Update commit index based on replicated entries
   */
  private updateCommitIndex(): void {
    for (let n = this.commitIndex + 1; n < this.log.length; n++) {
      const count = Array.from(this.matchIndex.values()).filter(i => i >= n).length + 1
      const majority = Math.floor((this.peers.length + 1) / 2) + 1

      if (count >= majority && this.log[n].term === this.currentTerm) {
        this.commitIndex = n
        this.applyCommittedEntries()
      }
    }
  }

  /**
   * Apply committed entries to state machine
   */
  private applyCommittedEntries(): void {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++
      const entry = this.log[this.lastApplied]
      this.applyToStateMachine(entry)
      this.emit('log_committed', { index: entry.index, command: entry.command })
    }
  }

  /**
   * Apply a log entry to the state machine
   */
  private applyToStateMachine(entry: LogEntry): void {
    const { command } = entry
    
    switch (command.type) {
      case 'schedule_task':
        this.stateMachine.set(`task-${Date.now()}`, command.data)
        break
      case 'update_node':
        this.stateMachine.set(`node-${(command.data as { id: string }).id}`, command.data)
        break
      case 'change_policy':
        this.stateMachine.set('policy', command.data)
        break
      case 'add_node':
        this.stateMachine.set(`node-${(command.data as { id: string }).id}`, command.data)
        break
      case 'remove_node':
        this.stateMachine.delete(`node-${(command.data as { id: string }).id}`)
        break
    }
  }

  /**
   * Propose a command (leader only)
   */
  propose(command: RaftCommand): boolean {
    if (this.state !== 'leader') {
      console.warn('[Raft] Only leader can propose commands')
      return false
    }

    const entry: LogEntry = {
      term: this.currentTerm,
      index: this.log.length,
      command,
      timestamp: Date.now(),
    }

    this.log.push(entry)
    this.matchIndex.set(this.nodeId, entry.index)

    console.log(`[Raft] Leader ${this.nodeId} proposed:`, command.type)
    return true
  }

  /**
   * Handle incoming RequestVote RPC
   */
  handleRequestVote(request: RequestVoteRequest): RequestVoteResponse {
    if (request.term > this.currentTerm) {
      this.currentTerm = request.term
      this.votedFor = null
      this.becomeFollower(request.term, null)
    }

    const logOk = request.lastLogIndex >= this.log.length - 1 &&
      (request.lastLogTerm > (this.log[this.log.length - 1]?.term || 0) ||
        request.lastLogTerm === (this.log[this.log.length - 1]?.term || 0) &&
        request.lastLogIndex >= this.log.length - 1)

    const grantVote = request.term === this.currentTerm &&
      (this.votedFor === null || this.votedFor === request.candidateId) &&
      logOk

    if (grantVote) {
      this.votedFor = request.candidateId
      this.resetElectionTimer()
    }

    return {
      term: this.currentTerm,
      voteGranted: grantVote,
    }
  }

  /**
   * Handle incoming AppendEntries RPC
   */
  handleAppendEntries(request: AppendEntriesRequest): AppendEntriesResponse {
    if (request.term > this.currentTerm) {
      this.currentTerm = request.term
      this.votedFor = null
    }

    if (request.term < this.currentTerm) {
      return { term: this.currentTerm, success: false, matchIndex: -1 }
    }

    this.becomeFollower(request.term, request.leaderId)

    // Check log consistency
    if (request.prevLogIndex >= 0) {
      if (this.log.length <= request.prevLogIndex) {
        return { term: this.currentTerm, success: false, matchIndex: this.log.length - 1 }
      }
      if (this.log[request.prevLogIndex].term !== request.prevLogTerm) {
        // Delete conflicting entries
        this.log = this.log.slice(0, request.prevLogIndex)
        return { term: this.currentTerm, success: false, matchIndex: this.log.length - 1 }
      }
    }

    // Append new entries
    for (const entry of request.entries) {
      if (this.log.length <= entry.index || this.log[entry.index].term !== entry.term) {
        this.log[entry.index] = entry
      }
    }

    // Update commit index
    if (request.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(request.leaderCommit, this.log.length - 1)
      this.applyCommittedEntries()
    }

    return { term: this.currentTerm, success: true, matchIndex: this.log.length - 1 }
  }

  /**
   * Check if this node is the leader
   */
  isLeader(): boolean {
    return this.state === 'leader'
  }

  /**
   * Get the current leader ID
   */
  getLeader(): string | null {
    return this.leaderId
  }

  /**
   * Get current state
   */
  getState(): RaftState {
    return this.state
  }

  /**
   * Get metrics
   */
  getMetrics(): RaftMetrics {
    return {
      state: this.state,
      currentTerm: this.currentTerm,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      logLength: this.log.length,
      leaderId: this.leaderId,
      votesReceived: this.votesReceived,
      peers: this.peers.length,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: RaftEvent, callback: RaftCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: RaftEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        console.error('[Raft] Callback error:', error)
      }
    })
  }
}

// Factory function to create a Raft cluster
export function createRaftCluster(nodeIds: string[]): RaftConsensus[] {
  return nodeIds.map((nodeId, _index, all) => {
    const peers = all.filter(id => id !== nodeId)
    return new RaftConsensus({
      nodeId,
      peers,
    })
  })
}

export type { RaftState, LogEntry, RaftCommand, RaftConfig, RaftMetrics }
