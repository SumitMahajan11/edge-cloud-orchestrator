import { Logger } from 'pino';

/**
 * Mock Redis implementation for local development.
 * Extracted from index.ts to improve type safety and maintainability.
 */
export const createMockRedis = (logger: Logger) => {
  const mockStorage = new Map<string, any>();
  const zsets = new Map<string, { member: string; score: number }[]>();

  const baseMockRedis = {
    isMock: true,
    get: async (key: string) => mockStorage.get(key) || null,
    set: async (key: string, value: any, ..._args: any[]) => {
      mockStorage.set(key, value);
      return 'OK';
    },
    setex: async (key: string, _s: number, value: any) => {
      mockStorage.set(key, value);
      return 'OK';
    },
    del: async (...keys: string[]) => {
      keys.forEach((k) => {
        mockStorage.delete(k);
        zsets.delete(k);
      });
      return keys.length;
    },
    ping: async () => 'PONG',
    publish: async () => 0,
    subscribe: async () => {},
    psubscribe: async () => {},
    punsubscribe: async () => {},
    on: function() {
      return this;
    },
    off: function() {
      return this;
    },
    quit: async () => 'OK',
    disconnect: () => {},
    duplicate: function() {
      return this;
    },
    defineCommand: () => {},
    zrange: async (key: string, start: number, stop: number) => {
      const set = zsets.get(key) || [];
      const result = set
        .sort((a, b) => a.score - b.score)
        .slice(start, stop === -1 ? undefined : stop + 1)
        .map((i) => i.member);
      logger.debug({ key, start, stop, count: result.length }, '[Redis Mock] zrange');
      return result;
    },
    zrevrange: async (key: string, start: number, stop: number) => {
      const set = zsets.get(key) || [];
      const result = set
        .sort((a, b) => b.score - a.score)
        .slice(start, stop === -1 ? undefined : stop + 1)
        .map((i) => i.member);
      logger.info({ key, start, stop, count: result.length, first: result[0] }, '[Redis Mock] zrevrange');
      return result;
    },
    zrangebyscore: async (key: string, min: number | string, max: number | string) => {
      const set = zsets.get(key) || [];
      const minVal = typeof min === 'string' ? -Infinity : min;
      const maxVal = typeof max === 'string' ? Infinity : max;
      return set.filter((i) => i.score >= minVal && i.score <= maxVal).map((i) => i.member);
    },
    zpopmin: async (key: string, count: number = 1) => {
      const set = zsets.get(key) || [];
      set.sort((a, b) => a.score - b.score);
      const popped = set.splice(0, count);
      const result: (string | number)[] = [];
      popped.forEach((p) => {
        result.push(p.member);
        result.push(p.score);
      });
      logger.debug({ key, count, popped: popped.length }, '[Redis Mock] zpopmin');
      return result;
    },
    zcard: async (key: string) => {
      return (zsets.get(key) || []).length;
    },
    zadd: async (key: string, score: number, member: string) => {
      logger.info({ key, score, member }, '[Redis Mock] zadd');
      let set = zsets.get(key);
      if (!set) {
        set = [];
        zsets.set(key, set);
      }
      const existing = set.find((i) => i.member === member);
      if (existing) {
        existing.score = score;
      } else {
        set.push({ member, score });
      }
      return 1;
    },
    zrem: async (key: string, ...members: string[]) => {
      const set = zsets.get(key) || [];
      const initialLen = set.length;
      const memberSet = new Set(members);
      const filtered = set.filter((i) => !memberSet.has(i.member));
      zsets.set(key, filtered);
      return initialLen - filtered.length;
    },
    zrank: async (key: string, member: string) => {
      const set = zsets.get(key) || [];
      const index = set.sort((a, b) => a.score - b.score).findIndex((i) => i.member === member);
      return index === -1 ? null : index;
    },
    zrevrank: async (key: string, member: string) => {
      const set = zsets.get(key) || [];
      const index = set.sort((a, b) => b.score - a.score).findIndex((i) => i.member === member);
      return index === -1 ? null : index;
    },
    zremrangebyscore: async (key: string, min: number, max: number) => {
      const set = zsets.get(key);
      if (!set) {
        return 0;
      }
      const initialLen = set.length;
      const newSet = set.filter((i) => i.score < min || i.score > max);
      zsets.set(key, newSet);
      return initialLen - newSet.length;
    },
    lrange: async () => [],
    lpush: async () => 0,
    rpush: async () => 0,
    llen: async () => 0,
    lrem: async () => 0,
    expire: async () => 1,
    ttl: async () => -1,
    keys: async () => [],
    hset: async () => 0,
    hget: async () => null,
    hgetall: async () => null,
    hdel: async () => 0,
    incr: async () => 1,
    decr: async () => 0,
    incrby: async () => 1,
    setnx: async () => 1,
    evalsha: async (..._args: any[]) => 1,
    eval: async (..._args: any[]) => 1,
    script: async (..._args: any[]) => 'OK',
    rateLimit: async (..._args: any[]) => [1, 100, 100, -1],
    pipeline: function() {
      const cmds: any[] = [];
      const p: any = {
        exec: async () => cmds.map(() => [null, 0]),
      };
      [
        'get', 'set', 'setex', 'del', 'incr', 'decr', 'incrby', 'expire', 'ttl',
        'zadd', 'zrem', 'zrange', 'zrevrange', 'zrangebyscore', 'zcard',
        'zremrangebyscore', 'zrank', 'zrevrank', 'lrange', 'lpush', 'rpush',
        'llen', 'lrem', 'ltrim', 'hset', 'hget', 'hdel', 'evalsha', 'eval', 'script'
      ].forEach((fn) => {
        p[fn] = (..._args: any[]) => {
          cmds.push(fn);
          return p;
        };
      });
      return p;
    },
    multi: function() {
      return (this as any).pipeline();
    },
  };

  return baseMockRedis as any;
};
