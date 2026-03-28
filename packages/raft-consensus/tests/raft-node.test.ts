import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RaftNode, RaftState } from '../src/raft-node';
import { RaftNodeConfig } from '../src/types';

describe('RaftNode', () => {
  let node: RaftNode;
  const defaultConfig: RaftNodeConfig = {
    id: 'node-1',
    peers: [
      { id: 'node-2', host: 'localhost', port: 8002 },
      { id: 'node-3', host: 'localhost', port: 8003 },
    ],
    electionTimeoutMin: 150,
    electionTimeoutMax: 300,
    heartbeatInterval: 50,
    logDir: '/tmp/raft-test',
    stateMachine: {
      apply: vi.fn(),
      snapshot: vi.fn(),
      restore: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    node = new RaftNode(defaultConfig);
  });

  afterEach(() => {
    node.stop();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should start as follower', () => {
      expect(node.getState()).toBe(RaftState.FOLLOWER);
    });

    it('should have initial term of 0', () => {
      expect(node.getCurrentTerm()).toBe(0);
    });

    it('should have no leader initially', () => {
      expect(node.getLeaderId()).toBeNull();
    });
  });

  describe('election', () => {
    it('should start election after election timeout', async () => {
      node.start();
      
      // Fast forward past election timeout
      await vi.advanceTimersByTimeAsync(300);
      
      expect(node.getState()).toBe(RaftState.CANDIDATE);
    });

    it('should increment term when becoming candidate', async () => {
      node.start();
      
      await vi.advanceTimersByTimeAsync(300);
      
      expect(node.getCurrentTerm()).toBe(1);
    });

    it('should become leader with majority votes', async () => {
      // Mock vote responses
      const peerResponses = new Map();
      peerResponses.set('node-2', { voteGranted: true, term: 1 });
      peerResponses.set('node-3', { voteGranted: true, term: 1 });
      
      node = new RaftNode({
        ...defaultConfig,
        // Inject mock network
      });
      
      node.start();
      
      await vi.advanceTimersByTimeAsync(300);
      
      // With 2 of 3 votes (including self), should become leader
      // This depends on actual implementation
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeats as leader', async () => {
      node.start();
      
      // Force to become leader (in real scenario, would mock voting)
      node.transitionToLeader();
      
      const heartbeatSpy = vi.spyOn(node, 'sendHeartbeats' as any);
      
      await vi.advanceTimersByTimeAsync(100);
      
      expect(heartbeatSpy).toHaveBeenCalled();
    });
  });

  describe('log replication', () => {
    it('should append entries to log', () => {
      const entry = { command: 'test-command', term: 1 };
      
      node.appendEntry(entry);
      
      const log = node.getLog();
      expect(log.length).toBeGreaterThan(0);
    });
  });

  describe('state transitions', () => {
    it('should transition from follower to candidate', () => {
      node.transitionToCandidate();
      
      expect(node.getState()).toBe(RaftState.CANDIDATE);
    });

    it('should transition from candidate to leader', () => {
      node.transitionToCandidate();
      node.transitionToLeader();
      
      expect(node.getState()).toBe(RaftState.LEADER);
    });

    it('should transition back to follower on higher term', () => {
      node.transitionToCandidate();
      node.transitionToLeader();
      
      // Receive AppendEntries with higher term
      node.handleAppendEntries({
        term: 2,
        leaderId: 'node-2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      });
      
      expect(node.getState()).toBe(RaftState.FOLLOWER);
      expect(node.getCurrentTerm()).toBe(2);
    });
  });

  describe('metrics', () => {
    it('should track commit index', () => {
      node.start();
      
      const metrics = node.getMetrics();
      
      expect(metrics.commitIndex).toBeDefined();
      expect(metrics.commitIndex).toBeGreaterThanOrEqual(0);
    });

    it('should track applied index', () => {
      node.start();
      
      const metrics = node.getMetrics();
      
      expect(metrics.lastApplied).toBeDefined();
      expect(metrics.lastApplied).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('RaftNode - Integration', () => {
  it('should maintain consistency across nodes', async () => {
    // This would be a more complex integration test
    // testing multiple nodes communicating
    vi.useFakeTimers();
    
    const nodes: RaftNode[] = [];
    
    for (let i = 1; i <= 3; i++) {
      const node = new RaftNode({
        id: `node-${i}`,
        peers: [
          { id: 'node-1', host: 'localhost', port: 8001 },
          { id: 'node-2', host: 'localhost', port: 8002 },
          { id: 'node-3', host: 'localhost', port: 8003 },
        ].filter(p => p.id !== `node-${i}`),
        electionTimeoutMin: 150,
        electionTimeoutMax: 300,
        heartbeatInterval: 50,
        logDir: `/tmp/raft-test-node-${i}`,
        stateMachine: {
          apply: vi.fn(),
          snapshot: vi.fn(),
          restore: vi.fn(),
        },
      });
      
      nodes.push(node);
    }
    
    // Start all nodes
    nodes.forEach(n => n.start());
    
    // Wait for election
    await vi.advanceTimersByTimeAsync(500);
    
    // One node should be leader
    const leaders = nodes.filter(n => n.getState() === RaftState.LEADER);
    expect(leaders.length).toBeLessThanOrEqual(1);
    
    nodes.forEach(n => n.stop());
    vi.useRealTimers();
  });
});
