import bcrypt from 'bcryptjs';
import pino from 'pino';
import { env } from '../config/env';

const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

export interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  apiKey?: string | undefined;
  tenantId?: string | undefined;
}

export interface MockSession {
  id: string;
  userId: string;
  token: string;
  refreshToken?: string | undefined;
  refreshTokenHash?: string | undefined;
  expiresAt: Date;
  createdAt: Date;
}

export interface MockTask {
  id: string;
  userId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  nodeId?: string | undefined;
  priority?: string | undefined;
  isDeferrable?: boolean;
  maxDelayMinutes?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockNode {
  id: string;
  name: string;
  status: string;
  region: string;
  capacity: number;
  load: number;
  tasksRunning?: number | undefined;
  lastHeartbeat?: Date | undefined;
  healthHistory?: unknown[] | undefined;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaWhereClause {
  id?: string;
  email?: string;
  apiKey?: string;
}

export interface PrismaCreateData {
  id?: string;
  email?: string;
  passwordHash?: string;
  name?: string;
  role?: string;
  isActive?: boolean;
  emailVerified?: boolean;
  apiKey?: string;
}

export interface PrismaSessionWhere {
  id?: string;
  token?: string;
  refreshToken?: string;
  userId?: string;
}

export interface PrismaSessionCreate {
  id?: string;
  userId: string;
  token: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface PrismaTaskWhere {
  id?: string;
  status?: string;
  type?: string;
  nodeId?: string;
  priority?: string;
  userId?: string;
}

export interface PrismaTaskCreate {
  id?: string;
  userId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  nodeId?: string;
  priority?: string;
}

export interface PrismaNodeWhere {
  id?: string;
  name?: string;
  status?: string;
  region?: string;
}

const g = globalThis as any;
if (!g.__mockUsers) g.__mockUsers = new Map<string, MockUser>();
if (!g.__mockSessions) g.__mockSessions = new Map<string, MockSession>();
if (!g.__mockTasks) g.__mockTasks = new Map<string, MockTask>();
if (!g.__mockNodes) g.__mockNodes = new Map<string, MockNode>();

export const mockUsers: Map<string, MockUser> = g.__mockUsers;
export const mockSessions: Map<string, MockSession> = g.__mockSessions;
export const mockTasks: Map<string, MockTask> = g.__mockTasks;
export const mockNodes: Map<string, MockNode> = g.__mockNodes;
const mockExecutions = new Map<string, any>();
const mockDecisions = new Map<string, any>();
const mockSagas = new Map<string, any>();
const mockSagaSteps = new Map<string, any>();
const mockIdempotency = new Map<string, any>();

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function applyWhereForMock(items: any[], where: any) {
  if (!where) return items;
  return items.filter((item: any) => {
    for (const [k, v] of Object.entries(where)) {
      const val = v as any;
      if (val !== undefined) {
        if (val && typeof val === 'object' && val.in) {
          if (!val.in.includes(item[k])) return false;
        } else if (
          val &&
          typeof val === 'object' &&
          (val.lt || val.gte || val.gt || val.lte)
        ) {
          if (val.lt !== undefined && item[k] >= val.lt) return false;
          if (val.gte !== undefined && item[k] < val.gte) return false;
          if (val.gt !== undefined && item[k] <= val.gt) return false;
          if (val.lte !== undefined && item[k] > val.lte) return false;
        } else if (item[k] !== val) {
          return false;
        }
      }
    }
    return true;
  });
}

function createMockGroupBy(storeName: string) {
  return async (args: any = {}) => {
    const g = globalThis as any;
    const key = `__mock_${storeName}`;
    if (!g[key]) g[key] = new Map<string, any>();
    const store = g[key];

    const filtered = applyWhereForMock(Array.from(store.values()), args?.where);
    const byFields: string[] = args.by || [];

    const groups = new Map<string, any[]>();
    for (const item of filtered) {
      const groupKey = byFields.map(f => String(item[f])).join('|');
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(item);
    }

    const results = [];
    for (const [groupKey, groupItems] of groups.entries()) {
      const firstItem = groupItems[0];
      const resObj: any = {};
      for (const f of byFields) {
        resObj[f] = firstItem[f];
      }

      if (args._sum) {
        resObj._sum = {};
        for (const key of Object.keys(args._sum)) {
          let sum = 0;
          for (const item of groupItems) {
            sum += Number(item[key]) || 0;
          }
          resObj._sum[key] = sum;
        }
      }

      if (args._count !== undefined) {
        resObj._count = args._count === true ? groupItems.length : { id: groupItems.length };
      }

      results.push(resObj);
    }

    return results;
  };
}

function createMockAggregate(storeName: string) {
  return async (args: any = {}) => {
    const g = globalThis as any;
    const key = `__mock_${storeName}`;
    if (!g[key]) g[key] = new Map<string, any>();
    const store = g[key];

    const filtered = applyWhereForMock(Array.from(store.values()), args?.where);
    const result: any = {};
    if (args._sum) {
      result._sum = {};
      for (const key of Object.keys(args._sum)) {
        let sum = 0;
        for (const item of filtered) {
          sum += Number(item[key]) || 0;
        }
        result._sum[key] = sum;
      }
    }
    if (args._avg) {
      result._avg = {};
      for (const key of Object.keys(args._avg)) {
        let sum = 0;
        for (const item of filtered) {
          sum += Number(item[key]) || 0;
        }
        result._avg[key] = filtered.length ? sum / filtered.length : 0;
      }
    }
    if (args._count !== undefined) {
      result._count = filtered.length;
    }
    return result;
  };
}

function createMockModelStore<T extends { id: string }>(storeName: string) {
  const g = globalThis as any;
  const key = `__mock_${storeName}`;
  if (!g[key]) g[key] = new Map<string, T>();
  const store: Map<string, T> = g[key];

  return {
    store,
    groupBy: createMockGroupBy(storeName),
    aggregate: createMockAggregate(storeName),
    findUnique: async (args: any) => {
      const where = args?.where;
      if (!where) return null;
      if (where.id) return store.get(where.id) || null;
      const all = Array.from(store.values());
      return (
        all.find((item: any) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && item[k] !== v) return false;
          }
          return true;
        }) || null
      );
    },
    findFirst: async (args: any) => {
      const where = args?.where;
      const all = Array.from(store.values());
      if (!where) return all[0] || null;
      if (where.id) return store.get(where.id) || null;
      return (
        all.find((item: any) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && item[k] !== v) return false;
          }
          return true;
        }) || null
      );
    },
    findMany: async (args: any = {}) => {
      let all = Array.from(store.values());
      const where = args?.where;
      if (where) {
        all = all.filter((item: any) => {
          for (const [k, v] of Object.entries(where)) {
            const val = v as any;
            if (val !== undefined) {
              if (val && typeof val === 'object' && val.in) {
                if (!val.in.includes(item[k])) return false;
              } else if (
                val &&
                typeof val === 'object' &&
                (val.lt || val.gte || val.gt || val.lte)
              ) {
                if (val.lt !== undefined && item[k] >= val.lt) return false;
                if (val.gte !== undefined && item[k] < val.gte) return false;
                if (val.gt !== undefined && item[k] <= val.gt) return false;
                if (val.lte !== undefined && item[k] > val.lte) return false;
              } else if (item[k] !== val) {
                return false;
              }
            }
          }
          return true;
        });
      }
      if (args?.distinct) {
        const distinctFields = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
        const seen = new Set<string>();
        all = all.filter((item: any) => {
          const key = distinctFields.map((f: string) => String(item[f])).join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (args?.skip) all = all.slice(args.skip);
      if (args?.take) all = all.slice(0, args.take);
      return all;
    },
    create: async (args: any) => {
      const id = args.data?.id || generateUuid();
      const item = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      store.set(id, item);
      return item;
    },
    createMany: async (args: any = {}) => {
      const data = args?.data || [];
      const created = data.map((d: any) => {
        const id = d.id || generateUuid();
        const item = {
          id,
          ...d,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any;
        store.set(id, item);
        return item;
      });
      return { count: created.length };
    },
    update: async (args: any) => {
      const where = args?.where;
      if (!where) throw new Error('where clause required for update');
      let item: any = null;
      if (where.id) {
        item = store.get(where.id);
      } else {
        const all = Array.from(store.values());
        item = all.find((i: any) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && i[k] !== v) return false;
          }
          return true;
        });
      }
      if (!item) throw new Error(`Item not found for update`);
      const updated = { ...item, ...args.data, updatedAt: new Date() };
      store.set(item.id, updated);
      return updated;
    },
    updateMany: async (args: any = {}) => {
      const where = args?.where || {};
      const data = args?.data || {};
      let count = 0;
      for (const [id, item] of store.entries()) {
        let match = true;
        for (const [k, v] of Object.entries(where)) {
          if (v !== undefined && (item as any)[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) {
          store.set(id, { ...item, ...data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    delete: async (args: any) => {
      const where = args?.where;
      if (!where) throw new Error('where clause required for delete');
      let item: any = null;
      if (where.id) {
        item = store.get(where.id);
      } else {
        const all = Array.from(store.values());
        item = all.find((i: any) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && i[k] !== v) return false;
          }
          return true;
        });
      }
      if (item) store.delete(item.id);
      return item || { id: where.id };
    },
    deleteMany: async (args: any = {}) => {
      const where = args?.where || {};
      let count = 0;
      if (Object.keys(where).length === 0) {
        count = store.size;
        store.clear();
      } else {
        for (const [id, item] of store.entries()) {
          let match = true;
          for (const [k, v] of Object.entries(where)) {
            const val = v as any;
            if (val !== undefined) {
              if (val && typeof val === 'object' && val.in) {
                if (!val.in.includes((item as any)[k])) {
                  match = false;
                  break;
                }
              } else if ((item as any)[k] !== val) {
                match = false;
                break;
              }
            }
          }
          if (match) {
            store.delete(id);
            count++;
          }
        }
      }
      return { count };
    },
    count: async (args: any = {}) => {
      const where = args?.where || {};
      if (Object.keys(where).length === 0) return store.size;
      let count = 0;
      for (const item of store.values()) {
        let match = true;
        for (const [k, v] of Object.entries(where)) {
          if (v !== undefined && (item as any)[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      return count;
    },
    upsert: async (args: any) => {
      const where = args?.where;
      let existing: any = null;
      if (where?.id) {
        existing = store.get(where.id);
      } else if (where) {
        const all = Array.from(store.values());
        existing = all.find((i: any) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && i[k] !== v) return false;
          }
          return true;
        });
      }
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        store.set(existing.id, updated);
        return updated;
      }
      const id =
        where?.id ||
        args.create?.id ||
        `mock-${storeName}-${Math.floor(Math.random() * 1000000000000)
          .toString()
          .padStart(12, '0')}`;
      const created = {
        id,
        ...args.create,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(id, created);
      return created;
    },
    aggregate: async (args: any = {}) => {
      const where = args?.where || {};
      let items = Array.from(store.values());

      if (where) {
        items = items.filter((item: any) => {
          for (const [k, v] of Object.entries(where)) {
            const val = v as any;
            if (val !== undefined) {
              if (val && typeof val === 'object' && val.in) {
                if (!val.in.includes(item[k])) return false;
              } else if (
                val &&
                typeof val === 'object' &&
                (val.lt || val.gte || val.gt || val.lte)
              ) {
                if (val.lt !== undefined && item[k] >= val.lt) return false;
                if (val.gte !== undefined && item[k] < val.gte) return false;
                if (val.gt !== undefined && item[k] <= val.gt) return false;
                if (val.lte !== undefined && item[k] > val.lte) return false;
              } else if (item[k] !== val) {
                return false;
              }
            }
          }
          return true;
        });
      }

      const result: any = {};

      if (args._sum) {
        result._sum = {};
        for (const key of Object.keys(args._sum)) {
          let total = 0;
          for (const item of items) {
            total += Number((item as any)[key]) || 0;
          }
          result._sum[key] = total;
        }
      }

      if (args._avg) {
        result._avg = {};
        for (const key of Object.keys(args._avg)) {
          let total = 0;
          for (const item of items) {
            total += Number((item as any)[key]) || 0;
          }
          result._avg[key] = items.length > 0 ? total / items.length : 0;
        }
      }

      if (args._min) {
        result._min = {};
        for (const key of Object.keys(args._min)) {
          let minVal =
            items.length > 0 ? Number((items[0] as any)[key]) || 0 : 0;
          for (const item of items) {
            const v = Number((item as any)[key]) || 0;
            if (v < minVal) minVal = v;
          }
          result._min[key] = minVal;
        }
      }

      if (args._max) {
        result._max = {};
        for (const key of Object.keys(args._max)) {
          let maxVal =
            items.length > 0 ? Number((items[0] as any)[key]) || 0 : 0;
          for (const item of items) {
            const v = Number((item as any)[key]) || 0;
            if (v > maxVal) maxVal = v;
          }
          result._max[key] = maxVal;
        }
      }

      if (args._count) {
        result._count = items.length;
      }

      return result;
    },
  };
}

// Seed default admin user for development (matches real seed credentials)
// Password: Admin123!
mockUsers.set('user-admin-seed', {
  id: 'user-admin-seed',
  email: 'admin@demo-org.com',
  passwordHash: bcrypt.hashSync('Admin123!', 10),
  name: 'Admin User',
  role: 'ADMIN',
  isActive: true,
  emailVerified: true,
  tenantId: 'tenant-demo-org',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  // tenantUsers join table expected by auth controller
  tenantUsers: [{ tenantId: 'tenant-demo-org', userId: 'user-admin-seed', role: 'ADMIN' }],
} as any);

// Also seed a regular user for testing
mockUsers.set('user-user1-seed', {
  id: 'user-user1-seed',
  email: 'user1@demo-org.com',
  passwordHash: bcrypt.hashSync('Password123!', 10),
  name: 'User One',
  role: 'VIEWER',
  isActive: true,
  emailVerified: true,
  tenantId: 'tenant-demo-org',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  tenantUsers: [{ tenantId: 'tenant-demo-org', userId: 'user-user1-seed', role: 'VIEWER' }],
} as any);

// Integration tests seed users
mockUsers.set('user-integration-admin', {
  id: 'user-integration-admin',
  email: 'admin@example.com',
  passwordHash: bcrypt.hashSync('admin123', 10),
  name: 'System Administrator',
  role: 'ADMIN',
  isActive: true,
  emailVerified: true,
  tenantId: 'tenant-demo-org',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  tenantUsers: [{ tenantId: 'tenant-demo-org', userId: 'user-integration-admin', role: 'ADMIN' }],
} as any);

mockUsers.set('user-integration-operator', {
  id: 'user-integration-operator',
  email: 'operator@example.com',
  passwordHash: bcrypt.hashSync('operator123', 10),
  name: 'System Operator',
  role: 'OPERATOR',
  isActive: true,
  emailVerified: true,
  tenantId: 'tenant-demo-org',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  tenantUsers: [{ tenantId: 'tenant-demo-org', userId: 'user-integration-operator', role: 'OPERATOR' }],
} as any);

mockUsers.set('user-integration-viewer', {
  id: 'user-integration-viewer',
  email: 'viewer@example.com',
  passwordHash: bcrypt.hashSync('viewer123', 10),
  name: 'System Viewer',
  role: 'VIEWER',
  isActive: true,
  emailVerified: true,
  tenantId: 'tenant-demo-org',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  tenantUsers: [{ tenantId: 'tenant-demo-org', userId: 'user-integration-viewer', role: 'VIEWER' }],
} as any);


export const mockPrisma = {
  isMock: true,
  user: {
    findUnique: async ({
      where,
    }: {
      where: PrismaWhereClause;
    }): Promise<MockUser | null> => {
      if (where.id) return mockUsers.get(where.id) || null;
      if (where.email) {
        return (
          Array.from(mockUsers.values()).find((u) => u.email === where.email) ||
          null
        );
      }
      if (where.apiKey) {
        return (
          Array.from(mockUsers.values()).find(
            (u) => u.apiKey === where.apiKey,
          ) || null
        );
      }
      return null;
    },
    findFirst: async (args: any): Promise<MockUser | null> => {
      const where = args?.where;
      if (where?.email) {
        return (
          Array.from(mockUsers.values()).find((u) => u.email === where.email) ||
          null
        );
      }
      return null;
    },
    create: async ({ data }: any): Promise<MockUser> => {
      const user: MockUser = {
        id:
          data.id ||
          `00000000-0000-4000-b000-${Math.floor(Math.random() * 1000000000000)
            .toString()
            .padStart(12, '0')}`,
        email: data.email!,
        passwordHash: data.passwordHash || '',
        name: data.name || '',
        role: data.role || 'USER',
        isActive: data.isActive ?? true,
        emailVerified: data.emailVerified ?? false,
        apiKey: data.apiKey,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      };
      mockUsers.set(user.id, user);
      return user;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: any;
    }): Promise<MockUser> => {
      const user = mockUsers.get(where.id);
      if (!user) throw new Error('User not found');
      const updated = { ...user, ...data, updatedAt: new Date() };
      mockUsers.set(where.id, updated);
      return updated;
    },
    upsert: async ({ where, create, update }: any): Promise<MockUser> => {
      let user = null;
      if (where.id) user = mockUsers.get(where.id);
      else if (where.email)
        user = Array.from(mockUsers.values()).find(
          (u) => u.email === where.email,
        );

      if (user) {
        const updated = { ...user, ...update, updatedAt: new Date() };
        mockUsers.set(user.id, updated);
        return updated;
      }
      const newUser: MockUser = {
        id: create.id || `user-${Date.now()}`,
        email: create.email,
        passwordHash: create.passwordHash || '',
        name: create.name || '',
        role: create.role || 'USER',
        isActive: create.isActive ?? true,
        emailVerified: create.emailVerified ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      };
      mockUsers.set(newUser.id, newUser);
      return newUser;
    },
    deleteMany: async (): Promise<any> => {
      const count = mockUsers.size;
      mockUsers.clear();
      return { count };
    },
    findMany: async (args: any = {}): Promise<MockUser[]> => {
      let users = Array.from(mockUsers.values());
      const tenantId = args?.where?.tenantUsers?.some?.tenantId;
      if (tenantId) {
        users = users.filter((u) => u.tenantId === tenantId || (u.tenantUsers && u.tenantUsers.some((tu: any) => tu.tenantId === tenantId)));
      }
      return users;
    },
    count: async (args: any = {}): Promise<number> => {
      let users = Array.from(mockUsers.values());
      const tenantId = args?.where?.tenantUsers?.some?.tenantId;
      if (tenantId) {
        users = users.filter((u) => u.tenantId === tenantId || (u.tenantUsers && u.tenantUsers.some((tu: any) => tu.tenantId === tenantId)));
      }
      return users.length;
    },
  },
  session: {
    findUnique: async ({
      where,
    }: {
      where: PrismaSessionWhere;
    }): Promise<MockSession | null> => {
      if (where.id) return mockSessions.get(where.id) || null;
      if (where.token) {
        return (
          Array.from(mockSessions.values()).find(
            (s) => s.token === where.token,
          ) || null
        );
      }
      return null;
    },
    create: async ({
      data,
    }: {
      data: PrismaSessionCreate;
    }): Promise<MockSession> => {
      const session: MockSession = {
        id:
          data.id ||
          `00000000-0000-4000-c000-${Math.floor(Math.random() * 1000000000000)
            .toString()
            .padStart(12, '0')}`,
        userId: data.userId,
        token: data.token,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      };
      mockSessions.set(session.id, session);
      return session;
    },
    delete: async ({ where }: { where: { id: string } }): Promise<any> => {
      mockSessions.delete(where.id);
      return { id: where.id };
    },
    deleteMany: async ({
      where,
    }: {
      where: { userId: string };
    }): Promise<any> => {
      const sessionsToDelete = Array.from(mockSessions.values()).filter(
        (s) => s.userId === where.userId,
      );
      sessionsToDelete.forEach((s) => mockSessions.delete(s.id));
      return { count: sessionsToDelete.length };
    },
  },
  userSession: {
    findUnique: async (args: any) => {
      const where = args?.where || {};
      const include = args?.include;
      const all = Array.from(mockSessions.values());
      let session: any = null;
      if (where.id) session = mockSessions.get(where.id) || null;
      else if (where.refreshTokenHash)
        session =
          all.find((s) => s.refreshTokenHash === where.refreshTokenHash) ||
          null;

      if (session && include?.user) {
        session = {
          ...session,
          user: mockUsers.get(session.userId) || null,
        };
      }
      return session;
    },
    findFirst: async ({ where }: any) => {
      const all = Array.from(mockSessions.values());
      if (where.id) return mockSessions.get(where.id) || null;
      return all.find((s) => s.userId === where.userId) || null;
    },
    findMany: async ({ where }: any) => {
      const all = Array.from(mockSessions.values());
      if (!where) return all;
      return all.filter((s) => s.userId === where.userId);
    },
    create: async ({ data }: any) => {
      const session = {
        id: data.id || `session-${Date.now()}`,
        ...data,
        createdAt: new Date(),
      };
      mockSessions.set(session.id, session);
      return session;
    },
    update: async ({ where, data }: any) => {
      const session = mockSessions.get(where.id);
      if (!session) throw new Error('Session not found');
      const updated = { ...session, ...data, updatedAt: new Date() };
      mockSessions.set(where.id, updated);
      return updated;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const [id, session] of mockSessions.entries()) {
        if (!where || session.userId === where.userId) {
          mockSessions.set(id, { ...session, ...data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    delete: async ({ where }: any) => {
      const session = mockSessions.get(where.id);
      mockSessions.delete(where.id);
      return session || { id: where.id };
    },
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      if (!where || Object.keys(where).length === 0) {
        count = mockSessions.size;
        mockSessions.clear();
      } else {
        for (const [id, session] of mockSessions.entries()) {
          if (session.userId === where.userId) {
            mockSessions.delete(id);
            count++;
          }
        }
      }
      return { count };
    },
  },
  task: {
    findMany: async (args: any = {}): Promise<MockTask[]> => {
      const where = args?.where;
      const orderBy = args?.orderBy;
      const skip = args?.skip;
      const take = args?.take;
      let tasks = Array.from(mockTasks.values());
      // Minimal-subset filters: status, nodeId, type, priority (including `in` arrays)
      if (where) {
        if (where.status) {
          if (typeof where.status === 'string') {
            tasks = tasks.filter((t) => t.status === where.status);
          } else if (where.status.in) {
            tasks = tasks.filter((t) => where.status.in.includes(t.status));
          }
        }
        if (where.userId) tasks = tasks.filter((t) => t.userId === where.userId);
        if (where.nodeId) tasks = tasks.filter((t) => (t as any).nodeId === where.nodeId);
        if (where.type) {
          if (typeof where.type === 'string') {
            tasks = tasks.filter((t) => t.type === where.type);
          } else if (where.type.in) {
            tasks = tasks.filter((t) => where.type.in.includes(t.type));
          }
        }
        if (where.priority) {
          if (typeof where.priority === 'string') {
            tasks = tasks.filter((t) => t.priority === where.priority);
          } else if (where.priority.in) {
            tasks = tasks.filter((t) => where.priority.in.includes(t.priority));
          }
        }
        if (where.tenantId) tasks = tasks.filter((t) => (t as any).tenantId === where.tenantId);
        if (where.id) {
          if (typeof where.id === 'string') {
            tasks = tasks.filter((t) => t.id === where.id);
          } else if (where.id.in) {
            tasks = tasks.filter((t) => where.id.in.includes(t.id));
          }
        }
        if (where.name) {
          if (typeof where.name === 'string') {
            tasks = tasks.filter((t) => (t as any).name === where.name);
          } else if (where.name.startsWith) {
            tasks = tasks.filter((t) => (t as any).name?.startsWith(where.name.startsWith));
          }
        }
      }
      // Single-field orderBy
      if (orderBy) {
        const field = typeof orderBy === 'object' ? Object.keys(orderBy)[0] : null;
        const dir = field ? (orderBy as any)[field] : null;
        if (field) {
          tasks.sort((a: any, b: any) => {
            const av = a[field], bv = b[field];
            if (av < bv) return dir === 'desc' ? 1 : -1;
            if (av > bv) return dir === 'desc' ? -1 : 1;
            return 0;
          });
        }
      }
      // Pagination
      if (typeof skip === 'number') tasks = tasks.slice(skip);
      if (typeof take === 'number') tasks = tasks.slice(0, take);
      return tasks;
    },
    findFirst: async (args: any): Promise<MockTask | null> => {
      const where = args?.where;
      let tasks = Array.from(mockTasks.values());
      if (where?.id) tasks = tasks.filter((t) => t.id === where.id);
      if (where?.status) tasks = tasks.filter((t) => t.status === where.status);
      if (where?.userId) tasks = tasks.filter((t) => t.userId === where.userId);
      if (where?.nodeId)
        tasks = tasks.filter((t) => (t as any).nodeId === where.nodeId);
      return tasks[0] || null;
    },
    create: async ({ data }: { data: PrismaTaskCreate }): Promise<MockTask> => {
      const task: MockTask = {
        id:
          data.id ||
          `00000000-0000-4000-d000-${Math.floor(Math.random() * 1000000000000)
            .toString()
            .padStart(12, '0')}`,
        userId: data.userId,
        type: data.type,
        status: data.status || 'PENDING',
        payload: data.payload,
        priority: data.priority,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(data as any),
      };
      // Handle nested execution creation
      if ((data as any).executions?.create) {
        const exec = (data as any).executions.create;
        const execId = generateUuid();
        mockExecutions.set(execId, { ...exec, id: execId, taskId: task.id });
      }
      if ((data as any).executions?.createMany?.data) {
        for (const exec of (data as any).executions.createMany.data) {
          const execId = generateUuid();
          mockExecutions.set(execId, { ...exec, id: execId, taskId: task.id });
        }
      }
      mockTasks.set(task.id, task);
      return task;
    },
    findUnique: async ({ where }: any): Promise<MockTask | null> => {
      return mockTasks.get(where.id) || null;
    },
    update: async ({ where, data }: any): Promise<MockTask> => {
      const task = mockTasks.get(where.id);
      if (!task) throw new Error(`Task ${where.id} not found`);
      const updated = { ...task, ...data, updatedAt: new Date() } as MockTask;
      // Handle nested execution updates (create only for mock simplicity)
      if ((data as any).executions?.create) {
        const exec = (data as any).executions.create;
        const execId = generateUuid();
        mockExecutions.set(execId, { ...exec, id: execId, taskId: updated.id });
      }
      mockTasks.set(where.id, updated);
      return updated;
    },
    count: async ({ where }: any = {}): Promise<number> => {
      let tasks = Array.from(mockTasks.values());
      if (where?.tenantId) {
        tasks = tasks.filter((t) => (t as any).tenantId === where.tenantId);
      }
      if (where?.nodeId) {
        tasks = tasks.filter((t) => (t as any).nodeId === where.nodeId);
      }
      if (where?.status) {
        if (typeof where.status === 'string') {
          tasks = tasks.filter((t) => t.status === where.status);
        } else if (where.status.in) {
          tasks = tasks.filter((t) => where.status.in.includes(t.status));
        }
      }
      return tasks.length;
    },
    deleteMany: async ({ where }: any = {}): Promise<any> => {
      let count = 0;
      if (!where || Object.keys(where).length === 0) {
        count = mockTasks.size;
        mockTasks.clear();
      } else {
        for (const [id, _task] of mockTasks.entries()) {
          if (where.id && where.id.in && where.id.in.includes(id)) {
            mockTasks.delete(id);
            count++;
          }
        }
      }
      return { count };
    },
    groupBy: createMockGroupBy('task'),
    aggregate: createMockAggregate('task'),
  },
  node: {
    findMany: async ({
      where,
    }: {
      where?: PrismaNodeWhere;
    }): Promise<MockNode[]> => {
      let nodes = Array.from(mockNodes.values());
      if (where?.status) nodes = nodes.filter((n) => n.status === where.status);
      return nodes;
    },
    findFirst: async (args: any): Promise<MockNode | null> => {
      const where = args?.where;
      let nodes = Array.from(mockNodes.values());
      if (where?.id) nodes = nodes.filter((n) => n.id === where.id);
      if (where?.name) nodes = nodes.filter((n) => n.name === where.name);
      if (where?.status) nodes = nodes.filter((n) => n.status === where.status);
      if (where?.tenantId)
        nodes = nodes.filter((n) => n.tenantId === where.tenantId);
      return nodes[0] || null;
    },
  },
  // edgeNode is the Prisma model name for nodes (PascalCase → camelCase)
  edgeNode: {
    findMany: async ({
      where,
      orderBy,
      skip,
      take,
      include,
    }: any = {}): Promise<any[]> => {
      let nodes = Array.from(mockNodes.values()) as any[];
      logger.info(
        {
          totalNodes: nodes.length,
          onlineNodes: nodes.filter((n) => n.status === 'ONLINE').length,
          where,
        },
        '[MockPrisma] findMany nodes',
      );
      const initialCount = nodes.length;
      if (where?.status) nodes = nodes.filter((n) => n.status === where.status);
      const statusCount = nodes.length;
      if (where?.tenantId)
        nodes = nodes.filter((n) => n.tenantId === where.tenantId);
      const tenantCount = nodes.length;
      if (where?.isMaintenanceMode !== undefined)
        nodes = nodes.filter(
          (n) => (n.isMaintenanceMode ?? false) === where.isMaintenanceMode,
        );
      if (where?.tasksRunning?.lt !== undefined)
        nodes = nodes.filter(
          (n) => (n.tasksRunning ?? 0) < where.tasksRunning.lt,
        );
      if (where?.cpuCores?.gte !== undefined)
        nodes = nodes.filter((n) => (n.cpuCores || 0) >= where.cpuCores.gte);
      if (where?.memoryGB?.gte !== undefined)
        nodes = nodes.filter((n) => (n.memoryGB || 0) >= where.memoryGB.gte);
      if (where?.lastHeartbeat?.lt instanceof Date)
        nodes = nodes.filter(
          (n) => new Date(n.lastHeartbeat) < (where.lastHeartbeat.lt as Date),
        );
      if (where?.lastHeartbeat?.gte instanceof Date)
        nodes = nodes.filter(
          (n) => new Date(n.lastHeartbeat) >= (where.lastHeartbeat.gte as Date),
        );

      const finalCount = nodes.length;
      if (finalCount < initialCount) {
        logger.info(
          { initialCount, statusCount, tenantCount, finalCount },
          '[MockPrisma] Filtered nodes',
        );
      }

      if (finalCount === 0 && initialCount > 0) {
        logger.debug(
          { initialCount, statusCount, tenantCount },
          '[MockPrisma] findMany returned 0 nodes',
        );
        logger.debug({ where }, '[MockPrisma] Filter details');
      }
      if (where?.region) nodes = nodes.filter((n) => n.region === where.region);
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as [string, string];
        nodes.sort((a, b) =>
          dir === 'asc'
            ? a[field] > b[field]
              ? 1
              : -1
            : a[field] < b[field]
              ? 1
              : -1,
        );
      }
      if (skip) nodes = nodes.slice(skip);
      if (take) nodes = nodes.slice(0, take);
      if (include?._count)
        nodes = nodes.map((n) => ({ ...n, _count: { tasks: 0 } }));
      return nodes;
    },
    findFirst: async (args: any): Promise<any | null> => {
      const where = args?.where;
      let nodes = Array.from(mockNodes.values());
      if (where?.id) nodes = nodes.filter((n) => (n as any).id === where.id);
      if (where?.name)
        nodes = nodes.filter((n) => (n as any).name === where.name);
      if (where?.status)
        nodes = nodes.filter((n) => (n as any).status === where.status);
      if (where?.tenantId)
        nodes = nodes.filter((n) => (n as any).tenantId === where.tenantId);
      return nodes[0] || null;
    },
    findUnique: async ({ where }: any): Promise<any | null> => {
      return mockNodes.get(where.id) || null;
    },
    create: async ({ data }: any): Promise<any> => {
      const id =
        data.id ||
        `00000000-0000-4000-a000-${Math.floor(Math.random() * 1000000000000)
          .toString()
          .padStart(12, '0')}`;
      const node = {
        id,
        name: data.name || 'Mock Node',
        location: data.location || 'Unknown',
        ipAddress: data.ipAddress || '127.0.0.1',
        port: data.port || 1024,
        region: data.region || 'us-east-1',
        cpuCores: data.cpuCores || 4,
        memoryGB: data.memoryGB || 8,
        storageGB: data.storageGB || 100,
        status: 'ONLINE',
        isMaintenanceMode: false,
        tasksRunning: 0,
        tenantId: data.tenantId || 'test-tenant',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (data.status === 'OFFLINE' || !data.status) node.status = 'ONLINE';
      mockNodes.set(node.id, node);
      return node;
    },
    createMany: async ({ data }: any): Promise<any> => {
      const results = [];
      for (const item of data) {
        const id =
          item.id ||
          `00000000-0000-4000-a000-${Math.floor(Math.random() * 1000000000000)
            .toString()
            .padStart(12, '0')}`;
        const node = {
          id,
          name: item.name || 'Mock Node',
          location: item.location || 'Unknown',
          ipAddress: item.ipAddress || '127.0.0.1',
          port: item.port || 1024,
          region: item.region || 'us-east-1',
          cpuCores: item.cpuCores || 4,
          memoryGB: item.memoryGB || 8,
          storageGB: item.storageGB || 100,
          status: 'ONLINE',
          isMaintenanceMode: false,
          tasksRunning: 0,
          tenantId: item.tenantId || 'test-tenant',
          ...item,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        if (item.status === 'OFFLINE' || !item.status) node.status = 'ONLINE';
        mockNodes.set(node.id, node);
        logger.info(
          { nodeId: node.id, total: mockNodes.size },
          '[MockPrisma] Node created in batch',
        );
        results.push(node);
      }
      return { count: results.length };
    },
    updateMany: async ({ where, data }: any): Promise<any> => {
      let count = 0;
      for (const [id, node] of mockNodes.entries()) {
        if (
          !where ||
          !where.tenantId ||
          (node as any).tenantId === where.tenantId
        ) {
          mockNodes.set(id, { ...node, ...data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    update: async ({ where, data }: any): Promise<any> => {
      const node = mockNodes.get(where.id);
      if (!node) throw new Error(`Node ${where.id} not found`);

      const updatedData = { ...data };
      for (const [key, value] of Object.entries(data)) {
        if (
          value &&
          typeof value === 'object' &&
          (value as any).increment !== undefined
        ) {
          updatedData[key] = (node as any)[key] + (value as any).increment;
        } else if (
          value &&
          typeof value === 'object' &&
          (value as any).decrement !== undefined
        ) {
          updatedData[key] = (node as any)[key] - (value as any).decrement;
        }
      }

      const updated = { ...node, ...updatedData, updatedAt: new Date() };
      mockNodes.set(where.id, updated);
      return updated;
    },
    count: async ({ where }: any = {}): Promise<number> => {
      let nodes = Array.from(mockNodes.values());
      if (where?.status) nodes = nodes.filter((n) => n.status === where.status);
      if (where?.tenantId)
        nodes = nodes.filter((n) => n.tenantId === where.tenantId);
      return nodes.length;
    },
    aggregate: async (args: any = {}): Promise<any> => {
      const where = args?.where;
      let nodes = Array.from(mockNodes.values());
      if (where) {
        if (where.status)
          nodes = nodes.filter((n) => n.status === where.status);
        if (where.tenantId)
          nodes = nodes.filter((n) => n.tenantId === where.tenantId);
      }

      const result: any = {};
      if (args._sum) {
        result._sum = {};
        for (const key of Object.keys(args._sum)) {
          result._sum[key] = nodes.reduce(
            (sum, n) => sum + (Number((n as any)[key]) || 0),
            0,
          );
        }
      }
      if (args._avg) {
        result._avg = {};
        for (const key of Object.keys(args._avg)) {
          const total = nodes.reduce(
            (sum, n) => sum + (Number((n as any)[key]) || 0),
            0,
          );
          result._avg[key] = nodes.length > 0 ? total / nodes.length : 0;
        }
      }
      if (args._count) {
        result._count = nodes.length;
      }
      return result;
    },
    delete: async ({ where }: any): Promise<any> => {
      const node = mockNodes.get(where.id);
      mockNodes.delete(where.id);
      return node;
    },
    deleteMany: async ({ where }: any = {}): Promise<any> => {
      let count = 0;
      if (!where || Object.keys(where).length === 0) {
        count = mockNodes.size;
        mockNodes.clear();
      } else {
        // Implement specific filters if needed
        for (const [id, _node] of mockNodes.entries()) {
          if (where.id && where.id.in && where.id.in.includes(id)) {
            mockNodes.delete(id);
            count++;
          }
        }
      }
      return { count };
    },
    upsert: async ({ where, create, update }: any): Promise<any> => {
      const existing = mockNodes.get(where.id);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        mockNodes.set(where.id, updated);
        return updated;
      }
      const node = {
        id: where.id || `node-${Date.now()}`,
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockNodes.set(node.id, node);
      return node;
    },
  },
  sagaInstance: {
    findMany: async ({ where }: any = {}) => {
      let sagas = Array.from(mockSagas.values());
      if (where?.status) {
        if (where.status.in) {
          sagas = sagas.filter((s) => where.status.in.includes(s.status));
        } else {
          sagas = sagas.filter((s) => s.status === where.status);
        }
      }
      return sagas;
    },
    findUnique: async ({ where, include }: any) => {
      const saga = mockSagas.get(where.id);
      if (!saga) return null;
      if (include?.steps) {
        saga.steps = Array.from(mockSagaSteps.values()).filter(
          (s) => s.sagaId === saga.id,
        );
        saga.steps.sort((a: any, b: any) => a.stepOrder - b.stepOrder);
      }
      return saga;
    },
    create: async ({ data }: any) => {
      const id = data.id || generateUuid();
      const saga = {
        ...data,
        id,
        startedAt: new Date(),
        updatedAt: new Date(),
        steps: [],
      };
      mockSagas.set(id, saga);
      return saga;
    },
    update: async ({ where, data }: any) => {
      const existing = mockSagas.get(where.id);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockSagas.set(where.id, updated);
      return updated;
    },
    updateMany: async ({ where, data }: any = {}) => {
      let count = 0;
      for (const [id, saga] of mockSagas.entries()) {
        if (!where || !where.id || saga.id === where.id) {
          mockSagas.set(id, { ...saga, ...data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    deleteMany: async () => {
      const count = mockSagas.size;
      mockSagas.clear();
      return { count };
    },
    count: async ({ where }: any = {}) => {
      let sagas = Array.from(mockSagas.values());
      if (where?.status) {
        sagas = sagas.filter((s) => s.status === where.status);
      }
      return sagas.length;
    },
  },
  sagaStep: {
    findMany: async ({ where }: any = {}) => {
      let steps = Array.from(mockSagaSteps.values());
      if (where?.sagaId) steps = steps.filter((s) => s.sagaId === where.sagaId);
      return steps;
    },
    create: async ({ data }: any) => {
      const id = data.id || generateUuid();
      const step = { ...data, id };
      mockSagaSteps.set(id, step);
      const saga = mockSagas.get(data.sagaId);
      if (saga) {
        saga.steps = saga.steps || [];
        saga.steps.push(step);
        saga.steps.sort((a: any, b: any) => a.stepOrder - b.stepOrder);
      }
      return step;
    },
    update: async ({ where, data }: any) => {
      const existing = mockSagaSteps.get(where.id);
      const updated = { ...existing, ...data };
      mockSagaSteps.set(where.id, updated);
      return updated;
    },
    updateMany: async ({ where, data }: any = {}) => {
      let count = 0;
      for (const [id, step] of mockSagaSteps.entries()) {
        let match = true;
        if (where?.sagaId && step.sagaId !== where.sagaId) match = false;
        if (
          where?.stepOrder !== undefined &&
          step.stepOrder !== where.stepOrder
        )
          match = false;
        if (match) {
          mockSagaSteps.set(id, { ...step, ...data });
          count++;
        }
      }
      return { count };
    },
    deleteMany: async () => {
      const count = mockSagaSteps.size;
      mockSagaSteps.clear();
      return { count };
    },
  },
  idempotencyRecord: {
    findUnique: async ({ where }: any) =>
      mockIdempotency.get(where.idempotencyKey) || null,
    findMany: async ({ where }: any) => {
      const all = Array.from(mockIdempotency.values());
      if (!where) {
        return all;
      }
      return all.filter((r) => r.idempotencyKey === where.idempotencyKey);
    },
    deleteMany: async () => {
      const count = mockIdempotency.size;
      mockIdempotency.clear();
      return { count };
    },
    create: async ({ data }: any) => {
      const record = {
        ...data,
        id: `idem-${Date.now()}`,
        createdAt: new Date(),
      };
      mockIdempotency.set(data.idempotencyKey, record);
      return record;
    },
    update: async ({ where, data }: any) => {
      const existing = mockIdempotency.get(where.idempotencyKey);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockIdempotency.set(where.idempotencyKey, updated);
      return updated;
    },
  },
  nodeHealthScore: createMockModelStore<any>('nodeHealthScore'),
  $connect: async () => {},
  $disconnect: async () => {},
  $queryRaw: async (_query: any) => [{ '?column?': 1 }],
  $executeRaw: async (_query: any) => 0,
  $queryRawUnsafe: async (_query: any, ..._values: any[]) => [{ result: 1 }],
  $executeRawUnsafe: async (_query: any, ..._values: any[]) => 0,
  $transaction: async (arg: any) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg(mockPrisma);
  },
  $extends: (extension: any) => {
    // Basic mock of $extends that merges query extensions
    const newMock = { ...mockPrisma } as any;

    if (extension.query) {
      // Handle $allModels and model-specific extensions
      const models = [
        'user',
        'session',
        'userSession',
        'task',
        'node',
        'edgeNode',
        'sagaInstance',
        'sagaStep',
        'idempotencyRecord',
        'auditLog',
        'apiKey',
        'webhook',
        'tenant',
        'nodeMetric',
        'schedulingDecision',
        'taskLog',
        'taskExecution',
        'certificateAuthority',
        'agentCertificate',
        'bootstrapToken',
        'alert',
        'certificateRevocation',
        'costRecord',
        'carbonRecord',
        'cRL',
        'deadLetterEvent',
        'fLModel',
        'fLSession',
        'nodeCertificate',
        'outboxEvent',
        'processedOffset',
        'tenantUser',
        'webhookDelivery',
        'workflow',
        'workflowExecution',
        'workflowTaskRun',
        'outcomeLog',
        'schedulingOutcome',
        'metricRetentionPolicy',
      ];

      for (const modelName of models) {
        const originalModel = (mockPrisma as any)[modelName];
        if (originalModel) {
          // Create a new model object to avoid modifying the original
          const newModel = { ...originalModel };
          newMock[modelName] = newModel;

          for (const opName in newModel) {
            if (typeof newModel[opName] === 'function') {
              newModel[opName] = async (args: any) => {
                const handler =
                  extension.query.$allModels?.$allOperations ||
                  extension.query[modelName]?.[opName] ||
                  extension.query[modelName]?.$allOperations;

                // Always get the current version of the operation from the original mockPrisma
                // This allows vi.spyOn() to work even after $extends has been called
                const currentOp = (mockPrisma as any)[modelName][opName];

                if (handler) {
                  return handler({
                    model: modelName,
                    operation: opName,
                    args,
                    query: currentOp,
                  });
                }
                return currentOp(args);
              };
            }
          }
        }
      }

      // Handle top-level operations like $queryRaw
      const topLevelOps = [
        '$queryRaw',
        '$executeRaw',
        '$queryRawUnsafe',
        '$executeRawUnsafe',
      ];
      for (const opName of topLevelOps) {
        if (typeof (newMock as any)[opName] === 'function') {
          newMock[opName] = async (args: any) => {
            const handler =
              extension.query[opName] || extension.query.$allOperations;
            const currentOp = (mockPrisma as any)[opName];
            if (handler) {
              return handler({ operation: opName, args, query: currentOp });
            }
            return currentOp(args);
          };
        }
      }
    }

    return newMock;
  },
  auditLog: {
    create: async ({ data }: any) => ({
      ...data,
      id: `00000000-0000-4000-a100-${Math.floor(Math.random() * 1000000000000)
        .toString()
        .padStart(12, '0')}`,
      createdAt: new Date(),
    }),
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    count: async () => 0,
  },
  apiKey: createMockModelStore('apiKey'),
  webhook: createMockModelStore('webhook'),
  tenant: createMockModelStore('tenant'),
  alertRule: createMockModelStore('alertRule'),
  nodeMetric: createMockModelStore('nodeMetric'),
  schedulingDecision: {
    create: async ({ data }: any) => {
      const id = `decision-${Date.now()}`;
      const decision = { ...data, id, timestamp: new Date() };
      mockDecisions.set(data.taskId, decision);
      return decision;
    },
    update: async ({ where, data }: any) => {
      const existing = mockDecisions.get(where.taskId || where.id);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockDecisions.set(where.taskId || where.id, updated);
      return updated;
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = mockDecisions.get(where.taskId);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        mockDecisions.set(where.taskId, updated);
        return updated;
      }
      const decision = {
        ...create,
        id: `decision-${Date.now()}`,
        timestamp: new Date(),
      };
      mockDecisions.set(where.taskId, decision);
      return decision;
    },
    findUnique: async ({ where }: any) =>
      mockDecisions.get(where.taskId || where.id) || null,
  },
  taskLog: {
    create: async ({ data }: any) => ({
      ...data,
      id: `00000000-0000-4000-a500-${Math.floor(Math.random() * 1000000000000)
        .toString()
        .padStart(12, '0')}`,
      timestamp: new Date(),
    }),
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    groupBy: createMockGroupBy('taskLog'),
    aggregate: createMockAggregate('taskLog'),
  },
  taskExecution: {
    aggregate: async ({ where }: any = {}) => {
      let sumCost = 0;
      for (const exec of mockExecutions.values()) {
        let match = true;
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && exec[k] !== v) {
              match = false;
              break;
            }
          }
        }
        if (match && exec.costUSD) {
          sumCost += Number(exec.costUSD) || 0;
        }
      }
      return {
        _sum: {
          costUSD: sumCost || 150.0,
        },
      };
    },
    groupBy: async () => {
      return [
        {
          nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-111111111111',
          _sum: { costUSD: 150.0 },
          _count: { id: 10 },
        },
      ];
    },
    create: async ({ data }: any) => {
      const id = `exec-${Math.floor(Math.random() * 1000000000).toString()}`;
      const exec = {
        ...data,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      logger.debug(
        { taskId: data.taskId, status: data.status },
        '[Mock Prisma] Creating execution',
      );
      mockExecutions.set(id, exec);
      return exec;
    },
    count: async ({ where }: any = {}) => {
      if (!where || Object.keys(where).length === 0) return mockExecutions.size;
      let count = 0;
      for (const exec of mockExecutions.values()) {
        let match = true;
        for (const [k, v] of Object.entries(where)) {
          if (v !== undefined && exec[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      return count;
    },
    findFirst: async ({ where }: any) => {
      const execs = Array.from(mockExecutions.values());
      const found = execs.find((e) => e.taskId === where.taskId);
      return found || null;
    },
    findUnique: async ({ where }: any) => mockExecutions.get(where.id) || null,
    update: async ({ where, data }: any) => {
      const existing = mockExecutions.get(where.id);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockExecutions.set(where.id, updated);
      return updated;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const [id, exec] of mockExecutions.entries()) {
        const matchesTask = exec.taskId === where.taskId;
        const matchesStatus = where.status
          ? exec.status === where.status
          : true;
        if (matchesTask && matchesStatus) {
          // Only update defined fields
          const updateData: any = {};
          for (const key in data) {
            if (data[key] !== undefined) {
              updateData[key] = data[key];
            }
          }
          mockExecutions.set(id, {
            ...exec,
            ...updateData,
            updatedAt: new Date(),
          });
          count++;
        }
      }
      return { count };
    },
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      if (!where || Object.keys(where).length === 0) {
        count = mockExecutions.size;
        mockExecutions.clear();
      } else {
        for (const [id, exec] of mockExecutions.entries()) {
          if (exec.taskId === where.taskId) {
            mockExecutions.delete(id);
            count++;
          }
        }
      }
      return { count };
    },
  },
  certificateAuthority: {
    findFirst: async () => null,
    create: async ({ data }: any) => ({
      ...data,
      id: `ca-${Date.now()}`,
      createdAt: new Date(),
    }),
  },
  agentCertificate: {
    findUnique: async () => null,
    create: async ({ data }: any) => ({
      ...data,
      id: `cert-${Date.now()}`,
      createdAt: new Date(),
    }),
  },
  bootstrapToken: {
    findUnique: async () => null,
    update: async ({ where, data }: any) => ({
      ...data,
      id: where.id || 'token',
      updatedAt: new Date(),
    }),
  },
  alert: createMockModelStore('alert'),
  schedulingPolicy: createMockModelStore('schedulingPolicy'),
  certificateRevocation: createMockModelStore('certificateRevocation'),
  costRecord: createMockModelStore('costRecord'),
  carbonRecord: createMockModelStore('carbonRecord'),
  cRL: createMockModelStore('cRL'),
  deadLetterEvent: createMockModelStore('deadLetterEvent'),
  fLModel: createMockModelStore('fLModel'),
  fLSession: createMockModelStore('fLSession'),
  nodeCertificate: createMockModelStore('nodeCertificate'),
  outboxEvent: createMockModelStore('outboxEvent'),
  processedOffset: createMockModelStore('processedOffset'),
  tenantUser: createMockModelStore('tenantUser'),
  webhookDelivery: createMockModelStore('webhookDelivery'),
  workflow: createMockModelStore('workflow'),
  workflowExecution: createMockModelStore('workflowExecution'),
  workflowTaskRun: createMockModelStore('workflowTaskRun'),
  schedulingOutcome: createMockModelStore('schedulingOutcome'),
  metricRetentionPolicy: createMockModelStore('metricRetentionPolicy'),
  outcomeLog: {
    createMany: async (args: any = {}) => {
      const data = args?.data || [];
      const created = [];
      const storeName = 'outcomeLog';
      const g = globalThis as any;
      const key = `__mock_${storeName}`;
      if (!g[key]) g[key] = new Map<string, any>();
      const store: Map<string, any> = g[key];

      for (const d of data) {
        const id = d.id || generateUuid();

        // 1. Resolve predictions from schedulingDecision
        const decision =
          mockDecisions.get(d.taskId) ||
          Array.from(mockDecisions.values()).find(
            (sd: any) => sd.taskId === d.taskId,
          );
        const explanation = decision?.explanation as any;
        const predictions = explanation?.predictions;

        const predictedMemoryUsage = predictions?.memoryUsage ?? 0.1;
        const tenantId = decision?.tenantId ?? 'tenant-1';

        // 2. Resolve actuals from nodeMetrics
        const metricsStore = g.__mock_nodeMetric;
        const latestMetric = metricsStore
          ? (Array.from(metricsStore.values())
              .filter((m: any) => m.nodeId === d.nodeId)
              .sort(
                (a: any, b: any) =>
                  b.timestamp.getTime() - a.timestamp.getTime(),
              )[0] as any)
          : null;
        const actualMemoryUsage = latestMetric?.memoryUsage ?? 0.3;

        const item = {
          id,
          ...d,
          predictedMemoryUsage,
          actualMemoryUsage,
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any;

        store.set(id, item);
        created.push(item);
      }
      return { count: created.length };
    },
    findMany: async (args: any = {}) => {
      const storeName = 'outcomeLog';
      const g = globalThis as any;
      const key = `__mock_${storeName}`;
      if (!g[key]) g[key] = new Map<string, any>();
      const store: Map<string, any> = g[key];

      let all = Array.from(store.values());
      const where = args?.where;
      if (where) {
        all = all.filter((item: any) => {
          for (const [k, v] of Object.entries(where)) {
            const val = v as any;
            if (val !== undefined) {
              if (item[k] !== val) return false;
            }
          }
          return true;
        });
      }
      return all;
    },
    findFirst: async (args: any = {}) => {
      const storeName = 'outcomeLog';
      const g = globalThis as any;
      const key = `__mock_${storeName}`;
      if (!g[key]) g[key] = new Map<string, any>();
      const store: Map<string, any> = g[key];

      const where = args?.where;
      const all = Array.from(store.values());
      if (!where) return all[0] || null;
      return (
        all.find((item: any) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined && item[k] !== v) return false;
          }
          return true;
        }) || null
      );
    },
    deleteMany: async () => {
      const storeName = 'outcomeLog';
      const g = globalThis as any;
      const key = `__mock_${storeName}`;
      if (!g[key]) g[key] = new Map<string, any>();
      const store: Map<string, any> = g[key];
      const count = store.size;
      store.clear();
      return { count };
    },
  },
};

export function initMockData() {
  const g = globalThis as any;

  // Seed default tenant if empty
  const tenantKey = '__mock_tenant';
  if (!g[tenantKey]) g[tenantKey] = new Map<string, any>();
  const mockTenants = g[tenantKey];
  if (mockTenants.size === 0) {
    mockTenants.set('tenant-demo-org', {
      id: 'tenant-demo-org',
      name: 'Demo Organization',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 1. Seed Nodes (mockNodes) if empty
  if (mockNodes.size === 0) {
    const nodes = [
      {
        id: 'da2b5a5c-7d9a-4f5d-8f5b-111111111111',
        name: 'Edge Node Alpha',
        location: 'New York, USA',
        region: 'us-east-1',
        latitude: 40.7128,
        longitude: -74.0060,
        status: 'ONLINE',
        ipAddress: '10.0.1.10',
        port: 4001,
        url: 'http://10.0.1.10:4001',
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 256,
        cpuUsage: 35.5,
        memoryUsage: 42.0,
        storageUsage: 50.0,
        latency: 24.5,
        tasksRunning: 2,
        maxTasks: 10,
        costPerHour: 0.04,
        bandwidthInMbps: 100,
        bandwidthOutMbps: 100,
        isMaintenanceMode: false,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-demo-org',
      },
      {
        id: 'da2b5a5c-7d9a-4f5d-8f5b-222222222222',
        name: 'Edge Node Beta',
        location: 'Dublin, Ireland',
        region: 'eu-west-1',
        latitude: 53.3498,
        longitude: -6.2603,
        status: 'ONLINE',
        ipAddress: '10.0.2.10',
        port: 4001,
        url: 'http://10.0.2.10:4001',
        cpuCores: 16,
        memoryGB: 32,
        storageGB: 512,
        cpuUsage: 62.1,
        memoryUsage: 78.5,
        storageUsage: 65.0,
        latency: 85.2,
        tasksRunning: 4,
        maxTasks: 20,
        costPerHour: 0.08,
        bandwidthInMbps: 1000,
        bandwidthOutMbps: 1000,
        isMaintenanceMode: false,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-demo-org',
      },
      {
        id: 'da2b5a5c-7d9a-4f5d-8f5b-333333333333',
        name: 'Edge Node Gamma',
        location: 'Tokyo, Japan',
        region: 'ap-northeast-1',
        latitude: 35.6762,
        longitude: 139.6503,
        status: 'ONLINE',
        ipAddress: '10.0.3.10',
        port: 4001,
        url: 'http://10.0.3.10:4001',
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 128,
        cpuUsage: 0.0,
        memoryUsage: 0.0,
        storageUsage: 0.0,
        latency: 0.0,
        tasksRunning: 0,
        maxTasks: 5,
        costPerHour: 0.02,
        bandwidthInMbps: 50,
        bandwidthOutMbps: 50,
        isMaintenanceMode: false,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-demo-org',
      },
      {
        id: 'da2b5a5c-7d9a-4f5d-8f5b-444444444444',
        name: 'Edge Node Delta',
        location: 'Oregon, USA',
        region: 'us-west-2',
        latitude: 45.5152,
        longitude: -122.6784,
        status: 'ONLINE',
        ipAddress: '10.0.4.10',
        port: 4001,
        url: 'http://10.0.4.10:4001',
        cpuCores: 32,
        memoryGB: 64,
        storageGB: 1024,
        cpuUsage: 12.4,
        memoryUsage: 31.0,
        storageUsage: 20.0,
        latency: 50.1,
        tasksRunning: 1,
        maxTasks: 40,
        costPerHour: 0.16,
        bandwidthInMbps: 10000,
        bandwidthOutMbps: 10000,
        isMaintenanceMode: false,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-demo-org',
      },
      {
        id: 'da2b5a5c-7d9a-4f5d-8f5b-555555555555',
        name: 'Edge Node Epsilon',
        location: 'São Paulo, Brazil',
        region: 'sa-east-1',
        latitude: -23.5505,
        longitude: -46.6333,
        status: 'DEGRADED',
        ipAddress: '10.0.5.10',
        port: 4001,
        url: 'http://10.0.5.10:4001',
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 256,
        cpuUsage: 88.0,
        memoryUsage: 92.5,
        storageUsage: 85.0,
        latency: 150.4,
        tasksRunning: 6,
        maxTasks: 10,
        costPerHour: 0.04,
        bandwidthInMbps: 100,
        bandwidthOutMbps: 100,
        isMaintenanceMode: false,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-demo-org',
      }
    ];

    for (const node of nodes) {
      mockNodes.set(node.id, node as any);
    }
  }

  // 2. Seed Tasks (mockTasks) if empty
  if (mockTasks.size === 0) {
    const tasks = [
      {
        id: 'ea2b5a5c-7d9a-4f5d-8f5b-111111111111',
        name: 'Image Inference Alpha',
        type: 'IMAGE_CLASSIFICATION',
        status: 'COMPLETED',
        priority: 'HIGH',
        target: 'EDGE',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-111111111111',
        policy: 'latency',
        reason: 'Lowest latency node in region',
        runtime: 'DOCKER',
        submittedAt: new Date(Date.now() - 1800000),
        tenantId: 'tenant-demo-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'ea2b5a5c-7d9a-4f5d-8f5b-222222222222',
        name: 'Sensor Stream Fusion',
        type: 'SENSOR_FUSION',
        status: 'RUNNING',
        priority: 'CRITICAL',
        target: 'EDGE',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-222222222222',
        policy: 'ml',
        reason: 'ML optimized node selection',
        runtime: 'WASM',
        submittedAt: new Date(Date.now() - 900000),
        tenantId: 'tenant-demo-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'ea2b5a5c-7d9a-4f5d-8f5b-333333333333',
        name: 'Video Stream Processing',
        type: 'VIDEO_PROCESSING',
        status: 'PENDING',
        priority: 'MEDIUM',
        target: 'HYBRID',
        nodeId: null,
        policy: 'cost',
        reason: 'Queued for optimal pricing window',
        runtime: 'DOCKER',
        submittedAt: new Date(Date.now() - 300000),
        tenantId: 'tenant-demo-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'ea2b5a5c-7d9a-4f5d-8f5b-444444444444',
        name: 'Log Pattern Detection',
        type: 'ANOMALY_DETECTION',
        status: 'FAILED',
        priority: 'LOW',
        target: 'CLOUD',
        nodeId: null,
        policy: 'cost',
        reason: 'Cloud allocation fallback failed',
        runtime: 'NATIVE',
        submittedAt: new Date(Date.now() - 3600000),
        tenantId: 'tenant-demo-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    for (const task of tasks) {
      mockTasks.set(task.id, task as any);
    }
  }

  // 3. Seed FLModels
  const flModelStoreKey = '__mock_fLModel';
  if (!g[flModelStoreKey]) g[flModelStoreKey] = new Map<string, any>();
  const flModelStore: Map<string, any> = g[flModelStoreKey];
  if (flModelStore.size === 0) {
    const models = [
      {
        id: 'fa2b5a5c-7d9a-4f5d-8f5b-111111111111',
        name: 'ResNet-50 Classifier',
        version: '1.2.0',
        architecture: 'CNN',
        parameters: 25600000,
        weightsUrl: 'http://storage.demo-org.com/resnet50.bin',
        weightsSize: 102400000,
        isActive: true,
        tenantId: 'tenant-demo-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'fa2b5a5c-7d9a-4f5d-8f5b-222222222222',
        name: 'LSTM Sequence Predictor',
        version: '0.9.5',
        architecture: 'RNN',
        parameters: 5400000,
        weightsUrl: 'http://storage.demo-org.com/lstm.bin',
        weightsSize: 22000000,
        isActive: true,
        tenantId: 'tenant-demo-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];
    for (const m of models) {
      flModelStore.set(m.id, m);
    }
  }

  // 4. Seed FLSessions
  const flSessionStoreKey = '__mock_fLSession';
  if (!g[flSessionStoreKey]) g[flSessionStoreKey] = new Map<string, any>();
  const flSessionStore: Map<string, any> = g[flSessionStoreKey];
  if (flSessionStore.size === 0) {
    const sessions = [
      {
        id: 'ca2b5a5c-7d9a-4f5d-8f5b-111111111111',
        modelId: 'fa2b5a5c-7d9a-4f5d-8f5b-111111111111',
        status: 'RUNNING',
        currentRound: 3,
        totalRounds: 10,
        config: { minClients: 5, learningRate: 0.01 },
        metrics: { accuracy: 0.88, loss: 0.32 },
        startedAt: new Date(),
        tenantId: 'tenant-demo-org',
      },
      {
        id: 'ca2b5a5c-7d9a-4f5d-8f5b-222222222222',
        modelId: 'fa2b5a5c-7d9a-4f5d-8f5b-222222222222',
        status: 'COMPLETED',
        currentRound: 5,
        totalRounds: 5,
        config: { minClients: 3, learningRate: 0.05 },
        metrics: { accuracy: 0.94, loss: 0.12 },
        startedAt: new Date(Date.now() - 86400000),
        completedAt: new Date(),
        tenantId: 'tenant-demo-org',
      }
    ];
    for (const s of sessions) {
      flSessionStore.set(s.id, s);
    }
  }

  // 5. Seed CostRecords
  const costRecordStoreKey = '__mock_costRecord';
  if (!g[costRecordStoreKey]) g[costRecordStoreKey] = new Map<string, any>();
  const costRecordStore: Map<string, any> = g[costRecordStoreKey];
  if (costRecordStore.size === 0) {
    const records = [
      {
        id: 'ba2b5a5c-7d9a-4f5d-8f5b-111111111111',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-111111111111',
        resourceType: 'COMPUTE',
        amount: 10.0,
        unit: 'HOURS',
        cost: 15.40,
        tenantId: 'tenant-demo-org',
        recordedAt: new Date(),
      },
      {
        id: 'ba2b5a5c-7d9a-4f5d-8f5b-222222222222',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-222222222222',
        resourceType: 'STORAGE',
        amount: 250.0,
        unit: 'GB',
        cost: 25.00,
        tenantId: 'tenant-demo-org',
        recordedAt: new Date(),
      },
      {
        id: 'ba2b5a5c-7d9a-4f5d-8f5b-333333333333',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-444444444444',
        resourceType: 'NETWORK',
        amount: 1000.0,
        unit: 'GB',
        cost: 90.00,
        tenantId: 'tenant-demo-org',
        recordedAt: new Date(),
      }
    ];
    for (const r of records) {
      costRecordStore.set(r.id, r);
    }
  }

  // 6. Seed CarbonRecords
  const carbonRecordStoreKey = '__mock_carbonRecord';
  if (!g[carbonRecordStoreKey]) g[carbonRecordStoreKey] = new Map<string, any>();
  const carbonRecordStore: Map<string, any> = g[carbonRecordStoreKey];
  if (carbonRecordStore.size === 0) {
    const nowMs = Date.now();
    const records = [
      {
        id: 'cr2b5a5c-7d9a-4f5d-8f5b-111111111111',
        taskId: 'task-1-carbon',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-111111111111',
        region: 'us-east-1',
        carbonIntensity: 350.0,
        durationMs: 3600000,
        estimatedGco2eq: 35.0,
        estimatedWatts: 100.0,
        wasDeferred: true,
        baselineGco2eq: 50.0,
        carbonSavedGco2eq: 15.0,
        tenantId: 'tenant-demo-org',
        recordedAt: new Date(nowMs - 3600000),
      },
      {
        id: 'cr2b5a5c-7d9a-4f5d-8f5b-222222222222',
        taskId: 'task-2-carbon',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-222222222222',
        region: 'eu-west-1',
        carbonIntensity: 200.0,
        durationMs: 7200000,
        estimatedGco2eq: 40.0,
        estimatedWatts: 100.0,
        wasDeferred: false,
        tenantId: 'tenant-demo-org',
        recordedAt: new Date(nowMs - 86400000),
      },
      {
        id: 'cr2b5a5c-7d9a-4f5d-8f5b-333333333333',
        taskId: 'task-3-carbon',
        nodeId: 'da2b5a5c-7d9a-4f5d-8f5b-111111111111',
        region: 'us-east-1',
        carbonIntensity: 380.0,
        durationMs: 1800000,
        estimatedGco2eq: 19.0,
        estimatedWatts: 100.0,
        wasDeferred: true,
        baselineGco2eq: 25.0,
        carbonSavedGco2eq: 6.0,
        tenantId: 'tenant-demo-org',
        recordedAt: new Date(nowMs - 172800000),
      }
    ];
    for (const r of records) {
      carbonRecordStore.set(r.id, r);
    }
  }

  // Start background heartbeat simulation for mock nodes to prevent stale timeout
  const heartbeatIntervalKey = '__mock_heartbeat_interval';
  if (!g[heartbeatIntervalKey]) {
    g[heartbeatIntervalKey] = setInterval(() => {
      for (const node of mockNodes.values()) {
        if (node.status === 'ONLINE' || node.status === 'DEGRADED') {
          node.lastHeartbeat = new Date();
        }
      }
    }, 10000);
  }
}
