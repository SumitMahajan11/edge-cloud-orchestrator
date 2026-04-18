// Type definitions for mock data
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
  apiKey?: string;
}

export interface MockSession {
  id: string;
  userId: string;
  token: string;
  refreshToken?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface MockTask {
  id: string;
  userId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  nodeId?: string;
  priority?: string;
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
  tasksRunning?: number;
  lastHeartbeat?: Date;
  healthHistory?: unknown[];
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

const mockUsers = new Map<string, MockUser>();
const mockSessions = new Map<string, MockSession>();
const mockTasks = new Map<string, MockTask>();
const mockNodes = new Map<string, MockNode>();

export const mockPrisma = {
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
    findFirst: async ({
      where,
    }: {
      where: PrismaWhereClause;
    }): Promise<MockUser | null> => {
      if (where.email) {
        return (
          Array.from(mockUsers.values()).find((u) => u.email === where.email) ||
          null
        );
      }
      return null;
    },
    create: async ({ data }: { data: PrismaCreateData }): Promise<MockUser> => {
      const user: MockUser = {
        id: data.id || `user-${Date.now()}`,
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
        id: data.id || `session-${Date.now()}`,
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
  task: {
    findMany: async ({
      where,
    }: {
      where?: PrismaTaskWhere;
    }): Promise<MockTask[]> => {
      let tasks = Array.from(mockTasks.values());
      if (where?.status) tasks = tasks.filter((t) => t.status === where.status);
      if (where?.userId) tasks = tasks.filter((t) => t.userId === where.userId);
      return tasks;
    },
    create: async ({ data }: { data: PrismaTaskCreate }): Promise<MockTask> => {
      const task: MockTask = {
        id: data.id || `task-${Date.now()}`,
        userId: data.userId,
        type: data.type,
        status: data.status,
        payload: data.payload,
        priority: data.priority,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockTasks.set(task.id, task);
      return task;
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
  },
  $connect: async () => {},
  $disconnect: async () => {},
};
