/**
 * Mock LeaderElection to always succeed immediately.
 * Must be called before any service that uses LeaderElection is instantiated.
 *
 * @returns A cleanup function that restores the original prototype method.
 */
export async function mockLeaderElectionToAlwaysLead(): Promise<() => void> {
  const { LeaderElection } = await import('@edgecloud/shared-kernel');

  const originalStart = LeaderElection.prototype.start;
  const originalIsCurrentlyLeader = LeaderElection.prototype.isCurrentlyLeader;

  LeaderElection.prototype.start = async function (id?: string) {
    console.log(`[MockLeaderElection] start called for ${id || 'unknown'}`);
    (this as any).isLeader = true;
    (this as any)._isLeader = true;
    this.emit('leadership-acquired');
    return true;
  };

  LeaderElection.prototype.isCurrentlyLeader = function () {
    return true;
  };

  // Return cleanup function
  return () => {
    LeaderElection.prototype.start = originalStart;
    LeaderElection.prototype.isCurrentlyLeader = originalIsCurrentlyLeader;
  };
}
