import { EventEmitter } from 'eventemitter3';
import { generateId } from '@edgecloud/shared-kernel';
import {
  RaftState,
  LogEntry,
  RaftNodeConfig,
  PeerConfig,
  VoteRequest,
  VoteResponse,
  AppendEntriesRequest,
  AppendEntriesResponse,
  RaftMetrics,
} from './types';

export interface StateMachine {
  apply(command: unknown): void;
  snapshot(): Buffer;
  restore(snapshot: Buffer): void;
}

export class RaftNode extends EventEmitter {
  // Node identity
  public readonly id: string;
  private config: RaftNodeConfig;
  
  // Persistent state
  private currentTerm: number = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  
  // Volatile state
  private state: RaftState = 'FOLLOWER';
  private commitIndex: number = 0;
  private lastApplied: number = 0;
  
  // Leader state (reinitialized after election)
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();
  
  // Timing
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeat: number = Date.now();
  
  // RPC clients
  private peers: Map<string, PeerClient> = new Map();
  
  // State machine
  private stateMachine: StateMachine;
  
  // Metrics
  private electionCount: number = 0;
  private heartbeatCount: number = 0;
  
  constructor(config: RaftNodeConfig, stateMachine: StateMachine) {
    super();
    this.id = config.id;
    this.config = config;
    this.stateMachine = stateMachine;
    
    // Initialize log with dummy entry at index 0
    this.log.push({
      term: 0,
      index: 0,
      command: null,
      timestamp: Date.now(),
    });
    
    // Initialize peer connections
    for (const peer of config.peers) {
      this.peers.set(peer.id, new PeerClient(peer));
    }
    
    this.resetElectionTimer();
  }
  
  // Public API
  
  public isLeader(): boolean {
    return this.state === 'LEADER';
  }
  
  public getState(): RaftState {
    return this.state;
  }
  
  public getCurrentTerm(): number {
    return this.currentTerm;
  }
  
  public getLeaderId(): string | undefined {
    return this.isLeader() ? this.id : undefined;
  }
  
  public getMetrics(): RaftMetrics {
    return {
      state: this.state,
      currentTerm: this.currentTerm,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      logSize: this.log.length,
      leaderId: this.getLeaderId(),
      votedFor: this.votedFor || undefined,
      electionCount: this.electionCount,
      heartbeatCount: this.heartbeatCount,
    };
  }
  
  public async replicateCommand(command: unknown): Promise<boolean> {
    if (!this.isLeader()) {
      throw new Error('Only leader can replicate commands');
    }
    
    // Append to local log
    const entry: LogEntry = {
      term: this.currentTerm,
      index: this.log.length,
      command,
      timestamp: Date.now(),
    };
    
    this.log.push(entry);
    this.persistState();
    
    // Replicate to followers
    await this.replicateLog();
    
    // Wait for commit
    return this.waitForCommit(entry.index);
  }
  
  public shutdown(): void {
    this.clearTimers();
    for (const peer of this.peers.values()) {
      peer.close();
    }
  }
  
  // RPC Handlers
  
  public async handleVoteRequest(request: VoteRequest): Promise<VoteResponse> {
    // Reply false if term < currentTerm
    if (request.term < this.currentTerm) {
      return {
        term: this.currentTerm,
        voteGranted: false,
        voterId: this.id,
      };
    }
    
    // If term > currentTerm, update term and convert to follower
    if (request.term > this.currentTerm) {
      this.currentTerm = request.term;
      this.votedFor = null;
      this.convertToFollower();
    }
    
    // Check if we can vote for this candidate
    const canVote = 
      (this.votedFor === null || this.votedFor === request.candidateId) &&
      this.isLogUpToDate(request.lastLogIndex, request.lastLogTerm);
    
    if (canVote) {
      this.votedFor = request.candidateId;
      this.persistState();
      this.resetElectionTimer();
    }
    
    return {
      term: this.currentTerm,
      voteGranted: canVote,
      voterId: this.id,
    };
  }
  
  public async handleAppendEntries(
    request: AppendEntriesRequest
  ): Promise<AppendEntriesResponse> {
    this.lastHeartbeat = Date.now();
    
    // Reply false if term < currentTerm
    if (request.term < this.currentTerm) {
      return {
        term: this.currentTerm,
        success: false,
        followerId: this.id,
        matchIndex: 0,
      };
    }
    
    // If term >= currentTerm, update term and convert to follower
    if (request.term > this.currentTerm || this.state !== 'FOLLOWER') {
      this.currentTerm = request.term;
      this.votedFor = null;
      this.convertToFollower();
    }
    
    this.resetElectionTimer();
    
    // Check log consistency
    if (request.prevLogIndex > 0) {
      const prevLogEntry = this.log[request.prevLogIndex];
      if (!prevLogEntry || prevLogEntry.term !== request.prevLogTerm) {
        // Find conflict index
        let conflictIndex = request.prevLogIndex;
        let conflictTerm = 0;
        
        if (prevLogEntry) {
          conflictTerm = prevLogEntry.term;
          while (
            conflictIndex > 0 &&
            this.log[conflictIndex]?.term === conflictTerm
          ) {
            conflictIndex--;
          }
        }
        
        return {
          term: this.currentTerm,
          success: false,
          followerId: this.id,
          matchIndex: 0,
          conflictIndex: conflictIndex + 1,
          conflictTerm,
        };
      }
    }
    
    // Append new entries
    for (let i = 0; i < request.entries.length; i++) {
      const entry = request.entries[i];
      const index = request.prevLogIndex + 1 + i;
      
      if (index < this.log.length) {
        // Existing entry conflicts with new entry
        if (this.log[index].term !== entry.term) {
          // Delete existing entry and all that follow it
          this.log = this.log.slice(0, index);
          this.log.push(entry);
        }
        // Otherwise, entry already exists and matches
      } else {
        this.log.push(entry);
      }
    }
    
    // Update commit index
    if (request.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(
        request.leaderCommit,
        this.log.length - 1
      );
      this.applyCommittedEntries();
    }
    
    this.persistState();
    
    return {
      term: this.currentTerm,
      success: true,
      followerId: this.id,
      matchIndex: request.prevLogIndex + request.entries.length,
    };
  }
  
  // Private methods
  
  private convertToFollower(): void {
    this.state = 'FOLLOWER';
    this.clearTimers();
    this.resetElectionTimer();
    this.emit('stateChanged', this.state);
  }
  
  private convertToCandidate(): void {
    this.state = 'CANDIDATE';
    this.currentTerm++;
    this.votedFor = this.id;
    this.persistState();
    
    this.electionCount++;
    this.emit('stateChanged', this.state);
    this.emit('electionStarted', this.currentTerm);
    
    // Request votes from all peers
    this.requestVotes();
  }
  
  private convertToLeader(): void {
    this.state = 'LEADER';
    this.clearTimers();
    
    // Initialize leader state
    const lastLogIndex = this.log.length - 1;
    for (const peerId of this.peers.keys()) {
      this.nextIndex.set(peerId, lastLogIndex + 1);
      this.matchIndex.set(peerId, 0);
    }
    
    this.emit('stateChanged', this.state);
    this.emit('becameLeader');
    
    // Start sending heartbeats
    this.sendHeartbeats();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeats(),
      this.config.heartbeatInterval
    );
  }
  
  private async requestVotes(): Promise<void> {
    const request: VoteRequest = {
      term: this.currentTerm,
      candidateId: this.id,
      lastLogIndex: this.log.length - 1,
      lastLogTerm: this.log[this.log.length - 1].term,
    };
    
    let votesReceived = 1; // Vote for self
    const majority = Math.floor((this.peers.size + 1) / 2) + 1;
    
    const votePromises = Array.from(this.peers.values()).map(async (peer) => {
      try {
        const response = await peer.requestVote(request);
        if (response.term > this.currentTerm) {
          this.currentTerm = response.term;
          this.votedFor = null;
          this.convertToFollower();
          return;
        }
        
        if (response.voteGranted) {
          votesReceived++;
          if (votesReceived >= majority && this.state === 'CANDIDATE') {
            this.convertToLeader();
          }
        }
      } catch (error) {
        // Peer unreachable, continue
      }
    });
    
    await Promise.all(votePromises);
    
    // If not enough votes and still candidate, restart election
    if (this.state === 'CANDIDATE' && votesReceived < majority) {
      this.resetElectionTimer();
    }
  }
  
  private async sendHeartbeats(): Promise<void> {
    if (!this.isLeader()) return;
    
    this.heartbeatCount++;
    
    const promises = Array.from(this.peers.entries()).map(
      async ([peerId, peer]) => {
        const nextIdx = this.nextIndex.get(peerId) || 1;
        const prevLogIndex = nextIdx - 1;
        const prevLogTerm = this.log[prevLogIndex]?.term || 0;
        
        // Get entries to send
        const entries = this.log.slice(
          nextIdx,
          nextIdx + this.config.maxLogEntriesPerRequest
        );
        
        const request: AppendEntriesRequest = {
          term: this.currentTerm,
          leaderId: this.id,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex,
        };
        
        try {
          const response = await peer.appendEntries(request);
          
          if (response.term > this.currentTerm) {
            this.currentTerm = response.term;
            this.votedFor = null;
            this.convertToFollower();
            return;
          }
          
          if (response.success) {
            this.matchIndex.set(peerId, response.matchIndex);
            this.nextIndex.set(peerId, response.matchIndex + 1);
          } else {
            // Decrement nextIndex and retry
            if (response.conflictIndex) {
              this.nextIndex.set(peerId, response.conflictIndex);
            } else {
              this.nextIndex.set(
                peerId,
                Math.max(1, (this.nextIndex.get(peerId) || 1) - 1)
              );
            }
          }
          
          this.updateCommitIndex();
        } catch (error) {
          // Peer unreachable
        }
      }
    );
    
    await Promise.all(promises);
  }
  
  private async replicateLog(): Promise<void> {
    await this.sendHeartbeats();
  }
  
  private updateCommitIndex(): void {
    if (!this.isLeader()) return;
    
    // Find the highest index that is replicated on a majority
    const matchIndexes = [
      this.log.length - 1,
      ...Array.from(this.matchIndex.values()),
    ];
    matchIndexes.sort((a, b) => b - a);
    
    const majorityIndex = matchIndexes[Math.floor(matchIndexes.length / 2)];
    
    if (
      majorityIndex > this.commitIndex &&
      this.log[majorityIndex].term === this.currentTerm
    ) {
      this.commitIndex = majorityIndex;
      this.applyCommittedEntries();
    }
  }
  
  private applyCommittedEntries(): void {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied];
      if (entry.command) {
        this.stateMachine.apply(entry.command);
        this.emit('commandApplied', entry);
      }
    }
  }
  
  private waitForCommit(index: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (index <= this.commitIndex) {
        resolve(true);
        return;
      }
      
      const checkCommit = () => {
        if (index <= this.commitIndex) {
          resolve(true);
        } else if (!this.isLeader()) {
          resolve(false);
        } else {
          setTimeout(checkCommit, 10);
        }
      };
      
      setTimeout(checkCommit, 10);
      
      // Timeout after 5 seconds
      setTimeout(() => resolve(false), 5000);
    });
  }
  
  private isLogUpToDate(lastLogIndex: number, lastLogTerm: number): boolean {
    const myLastLog = this.log[this.log.length - 1];
    if (myLastLog.term !== lastLogTerm) {
      return lastLogTerm > myLastLog.term;
    }
    return lastLogIndex >= this.log.length - 1;
  }
  
  private resetElectionTimer(): void {
    this.clearElectionTimer();
    
    const timeout =
      this.config.electionTimeoutMin +
      Math.random() *
        (this.config.electionTimeoutMax - this.config.electionTimeoutMin);
    
    this.electionTimer = setTimeout(() => {
      if (this.state !== 'LEADER') {
        this.convertToCandidate();
      }
    }, timeout);
  }
  
  private clearElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }
  
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  private clearTimers(): void {
    this.clearElectionTimer();
    this.clearHeartbeatTimer();
  }
  
  private persistState(): void {
    // Persist to disk (simplified - in production use proper storage)
    // this.storage.save({ currentTerm: this.currentTerm, votedFor: this.votedFor, log: this.log });
  }
}

// Placeholder for peer client
class PeerClient {
  constructor(private config: PeerConfig) {}
  
  async requestVote(request: VoteRequest): Promise<VoteResponse> {
    // Implement gRPC call
    throw new Error('Not implemented');
  }
  
  async appendEntries(request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
    // Implement gRPC call
    throw new Error('Not implemented');
  }
  
  close(): void {
    // Close connection
  }
}
