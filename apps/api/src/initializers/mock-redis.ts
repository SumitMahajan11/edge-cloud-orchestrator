import type { Logger } from 'pino';

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
    on: function () {
      return this;
    },
    off: function () {
      return this;
    },
    quit: async () => 'OK',
    disconnect: () => {},
    duplicate: function () {
      return this;
    },
    defineCommand: () => {},
    zrange: async (key: string, start: number, stop: number) => {
      const set = zsets.get(key) || [];
      const result = set
        .sort((a, b) => a.score - b.score)
        .slice(start, stop === -1 ? undefined : stop + 1)
        .map((i) => i.member);
      logger.debug(
        { key, start, stop, count: result.length },
        '[Redis Mock] zrange',
      );
      return result;
    },
    zrevrange: async (key: string, start: number, stop: number) => {
      const set = zsets.get(key) || [];
      const result = set
        .sort((a, b) => b.score - a.score)
        .slice(start, stop === -1 ? undefined : stop + 1)
        .map((i) => i.member);
      logger.info(
        { key, start, stop, count: result.length, first: result[0] },
        '[Redis Mock] zrevrange',
      );
      return result;
    },
    zrangebyscore: async (
      key: string,
      min: number | string,
      max: number | string,
    ) => {
      const set = zsets.get(key) || [];
      const minVal = typeof min === 'string' ? -Infinity : min;
      const maxVal = typeof max === 'string' ? Infinity : max;
      return set
        .filter((i) => i.score >= minVal && i.score <= maxVal)
        .map((i) => i.member);
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
      logger.debug(
        { key, count, popped: popped.length },
        '[Redis Mock] zpopmin',
      );
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
      const index = set
        .sort((a, b) => a.score - b.score)
        .findIndex((i) => i.member === member);
      return index === -1 ? null : index;
    },
    zrevrank: async (key: string, member: string) => {
      const set = zsets.get(key) || [];
      const index = set
        .sort((a, b) => b.score - a.score)
        .findIndex((i) => i.member === member);
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
    lrange: async (key: string, start: number, stop: number) => {
      const list = mockStorage.get(key);
      if (!Array.isArray(list)) return [];
      const end = stop === -1 ? undefined : stop + 1;
      return list.slice(start, end);
    },
    lpush: async (key: string, ...values: any[]) => {
      let list = mockStorage.get(key);
      if (!Array.isArray(list)) {
        list = [];
        mockStorage.set(key, list);
      }
      list.unshift(...values.reverse());
      return list.length;
    },
    rpush: async (key: string, ...values: any[]) => {
      let list = mockStorage.get(key);
      if (!Array.isArray(list)) {
        list = [];
        mockStorage.set(key, list);
      }
      list.push(...values);
      return list.length;
    },
    llen: async (key: string) => {
      const list = mockStorage.get(key);
      return Array.isArray(list) ? list.length : 0;
    },
    lrem: async (key: string, count: number, value: any) => {
      const list = mockStorage.get(key);
      if (!Array.isArray(list)) return 0;
      let removed = 0;
      if (count === 0) {
        const initialLen = list.length;
        const filtered = list.filter((v) => v !== value);
        mockStorage.set(key, filtered);
        return initialLen - filtered.length;
      }
      if (count > 0) {
        for (let i = 0; i < list.length && removed < count; i++) {
          if (list[i] === value) {
            list.splice(i, 1);
            i--;
            removed++;
          }
        }
      } else {
        const absCount = Math.abs(count);
        for (let i = list.length - 1; i >= 0 && removed < absCount; i--) {
          if (list[i] === value) {
            list.splice(i, 1);
            removed++;
          }
        }
      }
      return removed;
    },
    expire: async () => 1,
    ttl: async () => -1,
    keys: async () => [],
    hset: async (key: string, field: string, value: any) => {
      let hash = mockStorage.get(key);
      if (!(hash instanceof Map)) {
        hash = new Map();
        mockStorage.set(key, hash);
      }
      hash.set(field, value);
      return 1;
    },
    hget: async (key: string, field: string) => {
      const hash = mockStorage.get(key);
      if (!(hash instanceof Map)) return null;
      return hash.get(field) || null;
    },
    hgetall: async (key: string) => {
      const hash = mockStorage.get(key);
      if (!(hash instanceof Map)) return null;
      const obj: Record<string, any> = {};
      hash.forEach((v, k) => {
        obj[k] = v;
      });
      return obj;
    },
    hdel: async (key: string, ...fields: string[]) => {
      const hash = mockStorage.get(key);
      if (!(hash instanceof Map)) return 0;
      let deleted = 0;
      fields.forEach((f) => {
        if (hash.delete(f)) deleted++;
      });
      return deleted;
    },
    incr: async (key: string) => {
      const val = parseInt(mockStorage.get(key) || '0', 10) + 1;
      mockStorage.set(key, val.toString());
      return val;
    },
    decr: async (key: string) => {
      const val = parseInt(mockStorage.get(key) || '0', 10) - 1;
      mockStorage.set(key, val.toString());
      return val;
    },
    incrby: async (key: string, increment: number) => {
      const val = parseInt(mockStorage.get(key) || '0', 10) + increment;
      mockStorage.set(key, val.toString());
      return val;
    },
    setnx: async (key: string, value: any) => {
      if (mockStorage.has(key)) return 0;
      mockStorage.set(key, value);
      return 1;
    },
    evalsha: async (..._args: any[]) => 1,
    eval: async (..._args: any[]) => 1,
    script: async (..._args: any[]) => 'OK',
    rateLimit: async (..._args: any[]) => [1, 100, 100, -1],
    pipeline: function () {
      const cmds: any[] = [];
      const p: any = {
        exec: async () => cmds.map(() => [null, 0]),
      };
      [
        'get',
        'set',
        'setex',
        'del',
        'incr',
        'decr',
        'incrby',
        'expire',
        'ttl',
        'zadd',
        'zrem',
        'zrange',
        'zrevrange',
        'zrangebyscore',
        'zcard',
        'zremrangebyscore',
        'zrank',
        'zrevrank',
        'lrange',
        'lpush',
        'rpush',
        'llen',
        'lrem',
        'ltrim',
        'hset',
        'hget',
        'hdel',
        'evalsha',
        'eval',
        'script',
      ].forEach((fn) => {
        p[fn] = (..._args: any[]) => {
          cmds.push(fn);
          return p;
        };
      });
      return p;
    },
    multi: function () {
      return (this as any).pipeline();
    },
  };

  return baseMockRedis as any;
};
