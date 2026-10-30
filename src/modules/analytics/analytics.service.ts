import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IssueStatus,
  MilestoneStatus,
  ProjectRole,
  TaskPriority,
  TaskStatus,
  TimesheetStatus,
} from '@prisma/client';

import { RedisService } from '../../common/redis/redis.service';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

export interface ProjectDashboardData {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    startDate: string | null;
    endDate: string | null;
    organizationId: string;
    membersCount: number;
  };
  tasks: {
    total: number;
    completed: number;
    overdue: number;
    completionPercentage: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
  };
  issues: {
    total: number;
    open: number;
    resolved: number;
    byStatus: Record<IssueStatus, number>;
  };
  milestones: {
    total: number;
    completed: number;
    overdue: number;
    byStatus: Record<MilestoneStatus, number>;
  };
  timeTracking: {
    totalHours: number;
    approvedHours: number;
    pendingHours: number;
    draftHours: number;
  };
  cachedAt: string;
}

export interface MemberWorkload {
  userId: string;
  name: string;
  email: string;
  projectRole: ProjectRole;
  activeTasksCount: number;
  completedTasksCount: number;
  assignedIssuesCount: number;
  totalLoggedHours: number;
  approvedLoggedHours: number;
  workloadStatus: 'LIGHT' | 'BALANCED' | 'OVERLOADED';
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private getDashboardTtl(): number {
    return (
      this.configService.get<number>('redis.ttl.dashboard') ||
      Number(process.env.CACHE_TTL_DASHBOARD ?? 300)
    );
  }

  private getReportsTtl(): number {
    return (
      this.configService.get<number>('redis.ttl.reports') ||
      Number(process.env.CACHE_TTL_REPORTS ?? 600)
    );
  }

  async getProjectDashboard(
    projectId: string,
    userId: string,
  ): Promise<ProjectDashboardData> {
    await this.projectsService.assertProjectMember(projectId, userId);

    const cacheKey = `cache:dashboard:${projectId}`;
    const ttl = this.getDashboardTtl();

    return this.redisService.getOrSet(
      cacheKey,
      async () => this.computeProjectDashboard(projectId),
      ttl,
    );
  }

  private async computeProjectDashboard(
    projectId: string,
  ): Promise<ProjectDashboardData> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const now = new Date();

    const tasks = await this.prisma.task.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        status: true,
        priority: true,
        dueDate: true,
      },
    });

    const taskStatusCounts: Record<TaskStatus, number> = {
      [TaskStatus.TODO]: 0,
      [TaskStatus.IN_PROGRESS]: 0,
      [TaskStatus.IN_REVIEW]: 0,
      [TaskStatus.BLOCKED]: 0,
      [TaskStatus.DONE]: 0,
      [TaskStatus.CANCELLED]: 0,
    };

    const taskPriorityCounts: Record<TaskPriority, number> = {
      [TaskPriority.LOW]: 0,
      [TaskPriority.MEDIUM]: 0,
      [TaskPriority.HIGH]: 0,
      [TaskPriority.CRITICAL]: 0,
    };

    let overdueTasks = 0;
    let completedTasks = 0;

    for (const t of tasks) {
      taskStatusCounts[t.status] = (taskStatusCounts[t.status] || 0) + 1;
      taskPriorityCounts[t.priority] =
        (taskPriorityCounts[t.priority] || 0) + 1;

      if (t.status === TaskStatus.DONE) {
        completedTasks++;
      } else if (
        t.dueDate &&
        new Date(t.dueDate) < now &&
        t.status !== TaskStatus.CANCELLED
      ) {
        overdueTasks++;
      }
    }

    const issues = await this.prisma.issue.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, status: true },
    });

    const issueStatusCounts: Record<IssueStatus, number> = {
      [IssueStatus.OPEN]: 0,
      [IssueStatus.IN_PROGRESS]: 0,
      [IssueStatus.IN_REVIEW]: 0,
      [IssueStatus.RESOLVED]: 0,
      [IssueStatus.CLOSED]: 0,
      [IssueStatus.REOPENED]: 0,
    };

    let openIssues = 0;
    let resolvedIssues = 0;

    for (const issue of issues) {
      issueStatusCounts[issue.status] =
        (issueStatusCounts[issue.status] || 0) + 1;
      if (
        issue.status === IssueStatus.RESOLVED ||
        issue.status === IssueStatus.CLOSED
      ) {
        resolvedIssues++;
      } else {
        openIssues++;
      }
    }

    const milestones = await this.prisma.milestone.findMany({
      where: { projectId },
      select: { id: true, status: true, dueDate: true },
    });

    const milestoneStatusCounts: Record<MilestoneStatus, number> = {
      [MilestoneStatus.PLANNED]: 0,
      [MilestoneStatus.IN_PROGRESS]: 0,
      [MilestoneStatus.COMPLETED]: 0,
      [MilestoneStatus.OVERDUE]: 0,
      [MilestoneStatus.CANCELLED]: 0,
    };

    let completedMilestones = 0;
    let overdueMilestones = 0;

    for (const m of milestones) {
      milestoneStatusCounts[m.status] =
        (milestoneStatusCounts[m.status] || 0) + 1;
      if (m.status === MilestoneStatus.COMPLETED) {
        completedMilestones++;
      } else if (
        m.dueDate &&
        new Date(m.dueDate) < now &&
        m.status !== MilestoneStatus.CANCELLED
      ) {
        overdueMilestones++;
      }
    }

    const timeEntries = await this.prisma.timeEntry.findMany({
      where: { task: { projectId } },
      select: { hours: true, status: true },
    });

    let totalHours = 0;
    let approvedHours = 0;
    let pendingHours = 0;
    let draftHours = 0;

    for (const entry of timeEntries) {
      const h = Number(entry.hours);
      totalHours += h;
      if (entry.status === TimesheetStatus.APPROVED) {
        approvedHours += h;
      } else if (entry.status === TimesheetStatus.SUBMITTED) {
        pendingHours += h;
      } else if (entry.status === TimesheetStatus.DRAFT) {
        draftHours += h;
      }
    }

    const completionPercentage =
      tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;

    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate
          ? project.startDate.toISOString().split('T')[0]
          : null,
        endDate: project.endDate
          ? project.endDate.toISOString().split('T')[0]
          : null,
        organizationId: project.organizationId,
        membersCount: project._count.members,
      },
      tasks: {
        total: tasks.length,
        completed: completedTasks,
        overdue: overdueTasks,
        completionPercentage,
        byStatus: taskStatusCounts,
        byPriority: taskPriorityCounts,
      },
      issues: {
        total: issues.length,
        open: openIssues,
        resolved: resolvedIssues,
        byStatus: issueStatusCounts,
      },
      milestones: {
        total: milestones.length,
        completed: completedMilestones,
        overdue: overdueMilestones,
        byStatus: milestoneStatusCounts,
      },
      timeTracking: {
        totalHours: Number(totalHours.toFixed(2)),
        approvedHours: Number(approvedHours.toFixed(2)),
        pendingHours: Number(pendingHours.toFixed(2)),
        draftHours: Number(draftHours.toFixed(2)),
      },
      cachedAt: new Date().toISOString(),
    };
  }

  async getProjectWorkload(
    projectId: string,
    userId: string,
  ): Promise<{
    projectId: string;
    members: MemberWorkload[];
    cachedAt: string;
  }> {
    await this.projectsService.assertProjectMember(projectId, userId);

    const cacheKey = `cache:workload:${projectId}`;
    const ttl = this.getReportsTtl();

    return this.redisService.getOrSet(
      cacheKey,
      async () => this.computeProjectWorkload(projectId),
      ttl,
    );
  }

  private async computeProjectWorkload(
    projectId: string,
  ): Promise<{
    projectId: string;
    members: MemberWorkload[];
    cachedAt: string;
  }> {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const memberWorkloads: MemberWorkload[] = [];

    for (const member of members) {
      const tasks = await this.prisma.task.findMany({
        where: {
          projectId,
          assigneeId: member.userId,
          deletedAt: null,
        },
        select: { status: true },
      });

      const activeTasksCount = tasks.filter(
        (t) =>
          t.status !== TaskStatus.DONE && t.status !== TaskStatus.CANCELLED,
      ).length;
      const completedTasksCount = tasks.filter(
        (t) => t.status === TaskStatus.DONE,
      ).length;

      const assignedIssuesCount = await this.prisma.issue.count({
        where: {
          projectId,
          assigneeId: member.userId,
          deletedAt: null,
          status: { notIn: [IssueStatus.CLOSED, IssueStatus.RESOLVED] },
        },
      });

      const timeEntries = await this.prisma.timeEntry.findMany({
        where: {
          task: { projectId },
          userId: member.userId,
        },
        select: { hours: true, status: true },
      });

      const totalLoggedHours = timeEntries.reduce(
        (sum, e) => sum + Number(e.hours),
        0,
      );
      const approvedLoggedHours = timeEntries
        .filter((e) => e.status === TimesheetStatus.APPROVED)
        .reduce((sum, e) => sum + Number(e.hours), 0);

      let workloadStatus: 'LIGHT' | 'BALANCED' | 'OVERLOADED' = 'BALANCED';
      if (activeTasksCount > 6 || totalLoggedHours > 45) {
        workloadStatus = 'OVERLOADED';
      } else if (activeTasksCount < 3 && totalLoggedHours < 15) {
        workloadStatus = 'LIGHT';
      }

      memberWorkloads.push({
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
        projectRole: member.projectRole,
        activeTasksCount,
        completedTasksCount,
        assignedIssuesCount,
        totalLoggedHours: Number(totalLoggedHours.toFixed(2)),
        approvedLoggedHours: Number(approvedLoggedHours.toFixed(2)),
        workloadStatus,
      });
    }

    return {
      projectId,
      members: memberWorkloads,
      cachedAt: new Date().toISOString(),
    };
  }
}
