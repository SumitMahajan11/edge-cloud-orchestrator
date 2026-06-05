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

function createMockModelStore<T extends { id: string }>(storeName: string) {
  const g = globalThis as any;
  const key = `__mock_${storeName}`;
  if (!g[key]) g[key] = new Map<string, T>();
  const store: Map<string, T> = g[key];

  return {
    store,
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

// Seed default admin user for development
// Password: admin123
mockUsers.set('user-admin-seed', {
  id: 'user-admin-seed',
  email: 'admin@example.com',
  passwordHash: bcrypt.hashSync('admin123', 10),
  name: 'Admin User',
  role: 'ADMIN',
  isActive: true,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
});

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
    findMany: async ({ where }: { where?: any }): Promise<MockTask[]> => {
      let tasks = Array.from(mockTasks.values());
      if (where?.status) tasks = tasks.filter((t) => t.status === where.status);
      if (where?.userId) tasks = tasks.filter((t) => t.userId === where.userId);
      if (where?.nodeId)
        tasks = tasks.filter((t) => (t as any).nodeId === where.nodeId);
      if (where?.type) tasks = tasks.filter((t) => t.type === where.type);
      if (where?.priority)
        tasks = tasks.filter((t) => t.priority === where.priority);
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
      mockTasks.set(task.id, task);
      return task;
    },
    findUnique: async ({ where }: any): Promise<MockTask | null> => {
      return mockTasks.get(where.id) || null;
    },
    update: async ({ where, data }: any): Promise<MockTask> => {
      const task = mockTasks.get(where.id);
      if (!task) throw new Error(`Task ${where.id} not found`);
      const updated = { ...task, ...data, updatedAt: new Date() };
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
  },
  apiKey: createMockModelStore('apiKey'),
  webhook: createMockModelStore('webhook'),
  tenant: {
    findUnique: async ({ where }: any) => ({
      id: where.id || '00000000-0000-4000-a200-000000000000',
      name: 'Test Tenant',
      createdAt: new Date(),
    }),
    create: async ({ data }: any) => ({
      ...data,
      id: data.id || '00000000-0000-4000-a200-000000000000',
      createdAt: new Date(),
    }),
    delete: async ({ where }: any) => ({ id: where.id }),
    deleteMany: async () => ({ count: 1 }),
  },
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
          nodeId: '00000000-0000-4000-a000-000000000001',
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
  certificateRevocation: createMockModelStore('certificateRevocation'),
  costRecord: createMockModelStore('costRecord'),
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
