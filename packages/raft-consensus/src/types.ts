export type RaftState = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

export interface LogEntry {
  term: number;
  index: number;
  command: unknown;
  timestamp: number;
}

export interface RaftNodeConfig {
  id: string;
  host: string;
  port: number;
  peers: PeerConfig[];
  electionTimeoutMin: number;
  electionTimeoutMax: number;
  heartbeatInterval: number;
  maxLogEntriesPerRequest: number;
}

export interface PeerConfig {
  id: string;
  host: string;
  port: number;
}

export interface VoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface VoteResponse {
  term: number;
  voteGranted: boolean;
  voterId: string;
}

export interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
  followerId: string;
  matchIndex: number;
  conflictIndex?: number;
  conflictTerm?: number;
}

export interface InstallSnapshotRequest {
  term: number;
  leaderId: string;
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  offset: number;
  data: Buffer;
  done: boolean;
}

export interface InstallSnapshotResponse {
  term: number;
  followerId: string;
}

export interface RaftMetrics {
  state: RaftState;
  currentTerm: number;
  commitIndex: number;
  lastApplied: number;
  logSize: number;
  leaderId?: string;
  votedFor?: string;
  electionCount: number;
  heartbeatCount: number;
}
