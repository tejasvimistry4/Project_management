import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  OrganizationRole,
  Prisma,
  ProjectRole,
  TimesheetStatus,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  formatDateString,
  getPaginationOffset,
  getWeekRange,
  parseDateOnly,
} from '../../utils';
import { ProjectsService } from '../projects/projects.service';
import {
  ApproveTimeEntriesDto,
  CreateTimeEntryDto,
  DailyTimesheetQueryDto,
  PendingApprovalsQueryDto,
  ProjectSummaryQueryDto,
  RejectTimeEntriesDto,
  SubmitTimesheetDto,
  TimeEntryQueryDto,
  TimeEntrySortBy,
  SortOrder,
  UpdateTimeEntryDto,
  UserSummaryQueryDto,
  WeeklyTimesheetQueryDto,
} from './dto';

@Injectable()
export class TimeTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  private readonly timeEntryInclude = {
    task: {
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        projectId: true,
        project: {
          select: {
            id: true,
            name: true,
            organizationId: true,
          },
        },
      },
    },
    user: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    },
  };

  parseDateOnly(dateInput?: string | Date): Date {
    return parseDateOnly(dateInput);
  }

  formatDateString(date: Date): string {
    return formatDateString(date);
  }

  getWeekRange(dateInput?: string | Date): {
    monday: Date;
    sunday: Date;
    dates: string[];
  } {
    return getWeekRange(dateInput);
  }

  private formatEntry(entry: any) {
    return {
      ...entry,
      hours: Number(entry.hours),
      workDate:
        entry.workDate instanceof Date
          ? this.formatDateString(entry.workDate)
          : entry.workDate,
    };
  }

  private async validateDailyHourLimit(
    userId: string,
    workDate: Date,
    newHours: number,
    excludeEntryId?: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const existingEntries = await tx.timeEntry.findMany({
      where: {
        userId,
        workDate,
        ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
      },
      select: { hours: true },
    });

    const totalExisting = existingEntries.reduce(
      (sum, e) => sum + Number(e.hours),
      0,
    );
    if (totalExisting + newHours > 24) {
      throw new BadRequestException(
        `Daily logged hours cannot exceed 24 hours. Currently logged on ${this.formatDateString(workDate)}: ${totalExisting}h, requested: ${newHours}h (total: ${(totalExisting + newHours).toFixed(2)}h)`,
      );
    }
  }

  async create(userId: string, dto: CreateTimeEntryDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: dto.taskId },
      select: { id: true, title: true, projectId: true, deletedAt: true },
    });

    if (!task || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    const member = await this.projectsService.assertProjectMember(
      task.projectId,
      userId,
    );
    if (member.projectRole === ProjectRole.VIEWER) {
      throw new ForbiddenException(
        'Viewers do not have permission to log time',
      );
    }

    const parsedDate = this.parseDateOnly(dto.workDate);

    await this.validateDailyHourLimit(userId, parsedDate, dto.hours);

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.create({
        data: {
          taskId: dto.taskId,
          userId,
          hours: new Prisma.Decimal(dto.hours),
          workDate: parsedDate,
          notes: dto.notes ?? null,
          status: TimesheetStatus.DRAFT,
        },
        include: this.timeEntryInclude,
      });

      await tx.auditLog.create({
        data: {
          userId,
          entityType: 'TIME_ENTRY',
          entityId: entry.id,
          action: AuditAction.CREATE,
          metadata: {
            taskId: dto.taskId,
            hours: dto.hours,
            workDate: this.formatDateString(parsedDate),
            notes: dto.notes ?? null,
            status: TimesheetStatus.DRAFT,
          },
        },
      });

      return this.formatEntry(entry);
    });
  }

  async findAll(userId: string, query: TimeEntryQueryDto) {
    const whereClause: Prisma.TimeEntryWhereInput = {};

    if (query.projectId) {
      const member = await this.projectsService.assertProjectMember(
        query.projectId,
        userId,
      );
      whereClause.task = { projectId: query.projectId };

      const isLeader =
        (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
        member.projectRole === ProjectRole.PROJECT_MANAGER ||
        member.projectRole === ProjectRole.TEAM_LEAD;

      if (query.userId) {
        if (query.userId !== userId && !isLeader) {
          throw new ForbiddenException(
            'You do not have permission to view other users time entries',
          );
        }
        whereClause.userId = query.userId;
      } else if (!isLeader) {
        whereClause.userId = userId;
      }
    } else if (query.userId) {
      if (query.userId !== userId) {
        await this.assertReviewerAccessToUser(userId, query.userId);
      }
      whereClause.userId = query.userId;
    } else {
      whereClause.userId = userId;
    }

    if (query.taskId) {
      whereClause.taskId = query.taskId;
    }

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.startDate || query.endDate) {
      whereClause.workDate = {};
      if (query.startDate) {
        whereClause.workDate.gte = this.parseDateOnly(query.startDate);
      }
      if (query.endDate) {
        whereClause.workDate.lte = this.parseDateOnly(query.endDate);
      }
    }

    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const orderBy: Prisma.TimeEntryOrderByWithRelationInput = {};
    const sortField = query.sortBy ?? TimeEntrySortBy.WORK_DATE;
    const sortDirection = query.sortOrder ?? SortOrder.DESC;
    orderBy[sortField] = sortDirection;

    const [total, entries] = await Promise.all([
      this.prisma.timeEntry.count({ where: whereClause }),
      this.prisma.timeEntry.findMany({
        where: whereClause,
        include: this.timeEntryInclude,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return {
      data: entries.map((e) => this.formatEntry(e)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findById(id: string, userId: string) {
    const entry = await this.prisma.timeEntry.findUnique({
      where: { id },
      include: this.timeEntryInclude,
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (entry.userId === userId) {
      return this.formatEntry(entry);
    }

    const member = await this.projectsService.assertProjectMember(
      entry.task.projectId,
      userId,
    );
    const isLeader =
      (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
      member.projectRole === ProjectRole.PROJECT_MANAGER ||
      member.projectRole === ProjectRole.TEAM_LEAD;

    if (!isLeader) {
      throw new ForbiddenException(
        'You do not have permission to view this time entry',
      );
    }

    return this.formatEntry(entry);
  }

  async update(id: string, userId: string, dto: UpdateTimeEntryDto) {
    const entry = await this.prisma.timeEntry.findUnique({
      where: { id },
      include: this.timeEntryInclude,
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (entry.userId !== userId) {
      throw new ForbiddenException('You can only edit your own time entries');
    }

    if (entry.status === TimesheetStatus.APPROVED) {
      throw new BadRequestException(
        'Approved time entries are locked and cannot be modified',
      );
    }

    if (entry.status === TimesheetStatus.SUBMITTED) {
      throw new BadRequestException(
        'Submitted time entries cannot be modified. Please recall the timesheet first or wait for review.',
      );
    }

    let newTaskId = entry.taskId;
    if (dto.taskId && dto.taskId !== entry.taskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: dto.taskId },
        select: { id: true, projectId: true, deletedAt: true },
      });

      if (!task || task.deletedAt !== null) {
        throw new NotFoundException('New task not found');
      }

      const member = await this.projectsService.assertProjectMember(
        task.projectId,
        userId,
      );
      if (member.projectRole === ProjectRole.VIEWER) {
        throw new ForbiddenException(
          'Viewers do not have permission to log time',
        );
      }
      newTaskId = dto.taskId;
    }

    const targetDate = dto.workDate
      ? this.parseDateOnly(dto.workDate)
      : entry.workDate;
    const targetHours =
      dto.hours !== undefined ? dto.hours : Number(entry.hours);

    await this.validateDailyHourLimit(userId, targetDate, targetHours, id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.timeEntry.update({
        where: { id },
        data: {
          taskId: newTaskId,
          hours: new Prisma.Decimal(targetHours),
          workDate: targetDate,
          notes: dto.notes !== undefined ? dto.notes : entry.notes,
        },
        include: this.timeEntryInclude,
      });

      await tx.auditLog.create({
        data: {
          userId,
          entityType: 'TIME_ENTRY',
          entityId: id,
          action: AuditAction.UPDATE,
          metadata: {
            previous: {
              taskId: entry.taskId,
              hours: Number(entry.hours),
              workDate: this.formatDateString(entry.workDate),
              notes: entry.notes,
            },
            current: {
              taskId: newTaskId,
              hours: targetHours,
              workDate: this.formatDateString(targetDate),
              notes: updated.notes,
            },
          },
        },
      });

      return this.formatEntry(updated);
    });
  }

  async delete(id: string, userId: string) {
    const entry = await this.prisma.timeEntry.findUnique({
      where: { id },
      include: this.timeEntryInclude,
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (entry.status === TimesheetStatus.APPROVED) {
      throw new BadRequestException(
        'Approved time entries cannot be deleted to preserve audit integrity',
      );
    }

    const isAuthor = entry.userId === userId;
    let canDelete = isAuthor;

    if (!canDelete) {
      const member = await this.projectsService.assertProjectMember(
        entry.task.projectId,
        userId,
      );
      canDelete =
        (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
        member.projectRole === ProjectRole.PROJECT_MANAGER ||
        member.projectRole === ProjectRole.TEAM_LEAD;
    }

    if (!canDelete) {
      throw new ForbiddenException(
        'You do not have permission to delete this time entry',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.timeEntry.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId,
          entityType: 'TIME_ENTRY',
          entityId: id,
          action: AuditAction.DELETE,
          metadata: {
            taskId: entry.taskId,
            hours: Number(entry.hours),
            workDate: this.formatDateString(entry.workDate),
            deletedBy: userId,
          },
        },
      });

      return { message: 'Time entry deleted successfully', id };
    });
  }

  async getDailyTimesheet(userId: string, query: DailyTimesheetQueryDto) {
    const targetUserId = query.userId || userId;
    if (targetUserId !== userId) {
      await this.assertReviewerAccessToUser(userId, targetUserId);
    }

    const targetDate = this.parseDateOnly(query.date);
    const whereClause: Prisma.TimeEntryWhereInput = {
      userId: targetUserId,
      workDate: targetDate,
    };

    if (query.projectId) {
      await this.projectsService.assertProjectMember(query.projectId, userId);
      whereClause.task = { projectId: query.projectId };
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: whereClause,
      include: this.timeEntryInclude,
      orderBy: { id: 'asc' },
    });

    const formattedEntries = entries.map((e) => this.formatEntry(e));
    const totalHours = formattedEntries.reduce((sum, e) => sum + e.hours, 0);

    const hoursByStatus: Record<TimesheetStatus, number> = {
      [TimesheetStatus.DRAFT]: 0,
      [TimesheetStatus.SUBMITTED]: 0,
      [TimesheetStatus.APPROVED]: 0,
      [TimesheetStatus.REJECTED]: 0,
    };

    for (const e of formattedEntries) {
      hoursByStatus[e.status as TimesheetStatus] += e.hours;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true, role: true },
    });

    return {
      date: this.formatDateString(targetDate),
      user,
      totalHours: Number(totalHours.toFixed(2)),
      hoursByStatus,
      entriesCount: formattedEntries.length,
      entries: formattedEntries,
    };
  }

  async getWeeklyTimesheet(userId: string, query: WeeklyTimesheetQueryDto) {
    const targetUserId = query.userId || userId;
    if (targetUserId !== userId) {
      await this.assertReviewerAccessToUser(userId, targetUserId);
    }

    const { monday, sunday, dates } = this.getWeekRange(query.startDate);
    const whereClause: Prisma.TimeEntryWhereInput = {
      userId: targetUserId,
      workDate: {
        gte: monday,
        lte: sunday,
      },
    };

    if (query.projectId) {
      await this.projectsService.assertProjectMember(query.projectId, userId);
      whereClause.task = { projectId: query.projectId };
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: whereClause,
      include: this.timeEntryInclude,
      orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
    });

    const formattedEntries = entries.map((e) => this.formatEntry(e));
    const totalHours = formattedEntries.reduce((sum, e) => sum + e.hours, 0);

    const dayNames = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const dailyBreakdown = dates.map((dateStr, idx) => {
      const dayEntries = formattedEntries.filter((e) => e.workDate === dateStr);
      const dayTotal = dayEntries.reduce((sum, e) => sum + e.hours, 0);
      return {
        date: dateStr,
        dayOfWeek: dayNames[idx],
        hours: Number(dayTotal.toFixed(2)),
        entriesCount: dayEntries.length,
      };
    });

    const taskMap = new Map<
      string,
      {
        taskId: string;
        taskTitle: string;
        projectId: string;
        projectName: string;
        dailyHours: Record<string, number>;
        totalHours: number;
        entries: any[];
      }
    >();

    for (const e of formattedEntries) {
      if (!taskMap.has(e.taskId)) {
        const initialDays: Record<string, number> = {};
        for (const d of dates) {
          initialDays[d] = 0;
        }
        taskMap.set(e.taskId, {
          taskId: e.taskId,
          taskTitle: e.task.title,
          projectId: e.task.projectId,
          projectName: e.task.project.name,
          dailyHours: initialDays,
          totalHours: 0,
          entries: [],
        });
      }

      const item = taskMap.get(e.taskId)!;
      item.dailyHours[e.workDate] = Number(
        ((item.dailyHours[e.workDate] || 0) + e.hours).toFixed(2),
      );
      item.totalHours = Number((item.totalHours + e.hours).toFixed(2));
      item.entries.push(e);
    }

    const hoursByStatus: Record<TimesheetStatus, number> = {
      [TimesheetStatus.DRAFT]: 0,
      [TimesheetStatus.SUBMITTED]: 0,
      [TimesheetStatus.APPROVED]: 0,
      [TimesheetStatus.REJECTED]: 0,
    };

    for (const e of formattedEntries) {
      hoursByStatus[e.status as TimesheetStatus] += e.hours;
    }

    let overallStatus = 'EMPTY';
    if (formattedEntries.length > 0) {
      const statuses = new Set(formattedEntries.map((e) => e.status));
      if (statuses.size === 1) {
        overallStatus = formattedEntries[0].status;
      } else if (statuses.has(TimesheetStatus.APPROVED)) {
        overallStatus = 'PARTIALLY_APPROVED';
      } else {
        overallStatus = 'MIXED';
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true, role: true },
    });

    return {
      weekStartDate: this.formatDateString(monday),
      weekEndDate: this.formatDateString(sunday),
      user,
      totalHours: Number(totalHours.toFixed(2)),
      overallStatus,
      hoursByStatus,
      dailyBreakdown,
      taskMatrix: Array.from(taskMap.values()),
      entries: formattedEntries,
    };
  }

  async submitTimesheet(userId: string, dto: SubmitTimesheetDto) {
    const whereClause: Prisma.TimeEntryWhereInput = {
      userId,
      status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.REJECTED] },
    };

    if (dto.entryIds && dto.entryIds.length > 0) {
      whereClause.id = { in: dto.entryIds };
    } else if (dto.startDate || dto.endDate) {
      whereClause.workDate = {};
      if (dto.startDate) {
        whereClause.workDate.gte = this.parseDateOnly(dto.startDate);
      }
      if (dto.endDate) {
        whereClause.workDate.lte = this.parseDateOnly(dto.endDate);
      }
    }

    if (dto.projectId) {
      whereClause.task = { projectId: dto.projectId };
    }

    const eligibleEntries = await this.prisma.timeEntry.findMany({
      where: whereClause,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            projectId: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (eligibleEntries.length === 0) {
      throw new BadRequestException(
        'No draft or rejected time entries found to submit',
      );
    }

    const entryIds = eligibleEntries.map((e) => e.id);

    return this.prisma.$transaction(async (tx) => {
      await tx.timeEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { status: TimesheetStatus.SUBMITTED },
      });

      const projectMap = new Map<string, typeof eligibleEntries>();
      for (const entry of eligibleEntries) {
        const pid = entry.task.projectId;
        if (!projectMap.has(pid)) {
          projectMap.set(pid, []);
        }
        projectMap.get(pid)!.push(entry);
      }

      const authorName = eligibleEntries[0]?.user?.name || 'A team member';

      for (const [projectId, pEntries] of projectMap.entries()) {
        const leaders = await tx.projectMember.findMany({
          where: {
            projectId,
            projectRole: {
              in: [ProjectRole.TEAM_LEAD, ProjectRole.PROJECT_MANAGER],
            },
            userId: { not: userId },
          },
          select: { userId: true },
        });

        for (const leader of leaders) {
          await tx.notification.create({
            data: {
              userId: leader.userId,
              type: NotificationType.TIMESHEET_SUBMITTED,
              title: 'Timesheet Submitted for Review',
              message: `${authorName} submitted ${pEntries.length} time entry(ies) totaling ${pEntries.reduce((s, e) => s + Number(e.hours), 0)} hours for approval.`,
              payload: {
                projectId,
                submittedBy: userId,
                entryCount: pEntries.length,
              },
            },
          });
        }
      }

      for (const entry of eligibleEntries) {
        await tx.auditLog.create({
          data: {
            userId,
            entityType: 'TIME_ENTRY',
            entityId: entry.id,
            action: AuditAction.STATUS_CHANGE,
            metadata: {
              previousStatus: entry.status,
              newStatus: TimesheetStatus.SUBMITTED,
              submittedAt: new Date().toISOString(),
            },
          },
        });
      }

      return {
        message: 'Timesheet submitted successfully for review',
        submittedCount: entryIds.length,
        entryIds,
      };
    });
  }

  async recallTimesheet(userId: string, entryIds: string[]) {
    if (!entryIds || entryIds.length === 0) {
      throw new BadRequestException('entryIds array cannot be empty');
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        id: { in: entryIds },
        userId,
        status: TimesheetStatus.SUBMITTED,
      },
    });

    if (entries.length === 0) {
      throw new BadRequestException(
        'No submitted time entries found that can be recalled',
      );
    }

    const validIds = entries.map((e) => e.id);

    return this.prisma.$transaction(async (tx) => {
      await tx.timeEntry.updateMany({
        where: { id: { in: validIds } },
        data: { status: TimesheetStatus.DRAFT },
      });

      for (const entry of entries) {
        await tx.auditLog.create({
          data: {
            userId,
            entityType: 'TIME_ENTRY',
            entityId: entry.id,
            action: AuditAction.STATUS_CHANGE,
            metadata: {
              previousStatus: TimesheetStatus.SUBMITTED,
              newStatus: TimesheetStatus.DRAFT,
              reason: 'Recalled to draft by author',
            },
          },
        });
      }

      return {
        message: 'Timesheet recalled to draft successfully',
        recalledCount: validIds.length,
        entryIds: validIds,
      };
    });
  }

  async getPendingApprovals(
    reviewerId: string,
    query: PendingApprovalsQueryDto,
  ) {
    const leaderMemberships = await this.prisma.projectMember.findMany({
      where: {
        userId: reviewerId,
        projectRole: {
          in: [ProjectRole.PROJECT_MANAGER, ProjectRole.TEAM_LEAD],
        },
      },
      select: { projectId: true },
    });

    const orgAdminMemberships = await this.prisma.organizationMember.findMany({
      where: {
        userId: reviewerId,
        role: OrganizationRole.ADMIN,
      },
      include: {
        organization: {
          include: {
            projects: { select: { id: true } },
          },
        },
      },
    });

    const projectIdsSet = new Set<string>();
    for (const m of leaderMemberships) {
      projectIdsSet.add(m.projectId);
    }
    for (const om of orgAdminMemberships) {
      for (const p of om.organization.projects) {
        projectIdsSet.add(p.id);
      }
    }

    if (projectIdsSet.size === 0) {
      return {
        data: [],
        meta: { total: 0, page: 1, limit: query.limit ?? 20, totalPages: 0 },
      };
    }

    const projectIds = Array.from(projectIdsSet);
    const whereClause: Prisma.TimeEntryWhereInput = {
      status: TimesheetStatus.SUBMITTED,
      task: {
        projectId: query.projectId ? query.projectId : { in: projectIds },
      },
      userId: query.userId ? query.userId : { not: reviewerId },
    };

    if (query.projectId && !projectIdsSet.has(query.projectId)) {
      throw new ForbiddenException(
        'You do not have review permissions for this project',
      );
    }

    if (query.startDate || query.endDate) {
      whereClause.workDate = {};
      if (query.startDate) {
        whereClause.workDate.gte = this.parseDateOnly(query.startDate);
      }
      if (query.endDate) {
        whereClause.workDate.lte = this.parseDateOnly(query.endDate);
      }
    }

    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const [total, entries] = await Promise.all([
      this.prisma.timeEntry.count({ where: whereClause }),
      this.prisma.timeEntry.findMany({
        where: whereClause,
        include: this.timeEntryInclude,
        orderBy: { workDate: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: entries.map((e) => this.formatEntry(e)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async approveEntries(reviewerId: string, dto: ApproveTimeEntriesDto) {
    const entries = await this.prisma.timeEntry.findMany({
      where: { id: { in: dto.entryIds } },
      include: {
        task: { select: { id: true, title: true, projectId: true } },
        user: { select: { id: true, name: true } },
      },
    });

    if (entries.length !== dto.entryIds.length) {
      throw new NotFoundException('One or more time entries were not found');
    }

    for (const entry of entries) {
      if (entry.userId === reviewerId) {
        throw new ForbiddenException(
          'Reviewers cannot approve their own time entries. Another Team Lead or Project Manager must review it.',
        );
      }

      if (entry.status !== TimesheetStatus.SUBMITTED) {
        throw new BadRequestException(
          `Time entry ${entry.id} is not pending approval (current status: ${entry.status})`,
        );
      }

      await this.projectsService.assertProjectRole(
        entry.task.projectId,
        reviewerId,
        [ProjectRole.PROJECT_MANAGER, ProjectRole.TEAM_LEAD],
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.timeEntry.updateMany({
        where: { id: { in: dto.entryIds } },
        data: {
          status: TimesheetStatus.APPROVED,
          approvedById: reviewerId,
          approvedAt: now,
        },
      });

      for (const entry of entries) {
        await tx.auditLog.create({
          data: {
            userId: reviewerId,
            entityType: 'TIME_ENTRY',
            entityId: entry.id,
            action: AuditAction.APPROVE,
            metadata: {
              reviewerId,
              approvedAt: now.toISOString(),
              comment: dto.comment ?? null,
              hours: Number(entry.hours),
              workDate: this.formatDateString(entry.workDate),
            },
          },
        });

        await tx.notification.create({
          data: {
            userId: entry.userId,
            type: NotificationType.TIMESHEET_APPROVED,
            title: 'Time Entry Approved',
            message: `Your time entry for task "${entry.task.title}" (${Number(entry.hours)}h on ${this.formatDateString(entry.workDate)}) was approved.`,
            payload: {
              timeEntryId: entry.id,
              approvedBy: reviewerId,
              approvedAt: now.toISOString(),
            },
          },
        });
      }

      return {
        message: 'Time entries approved successfully',
        approvedCount: entries.length,
        entryIds: dto.entryIds,
      };
    });
  }

  async rejectEntries(reviewerId: string, dto: RejectTimeEntriesDto) {
    const entries = await this.prisma.timeEntry.findMany({
      where: { id: { in: dto.entryIds } },
      include: {
        task: { select: { id: true, title: true, projectId: true } },
        user: { select: { id: true, name: true } },
      },
    });

    if (entries.length !== dto.entryIds.length) {
      throw new NotFoundException('One or more time entries were not found');
    }

    for (const entry of entries) {
      if (entry.userId === reviewerId) {
        throw new ForbiddenException(
          'Reviewers cannot reject their own time entries',
        );
      }

      if (entry.status !== TimesheetStatus.SUBMITTED) {
        throw new BadRequestException(
          `Time entry ${entry.id} is not submitted for approval (current status: ${entry.status})`,
        );
      }

      await this.projectsService.assertProjectRole(
        entry.task.projectId,
        reviewerId,
        [ProjectRole.PROJECT_MANAGER, ProjectRole.TEAM_LEAD],
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.timeEntry.updateMany({
        where: { id: { in: dto.entryIds } },
        data: {
          status: TimesheetStatus.REJECTED,
          approvedById: null,
          approvedAt: null,
        },
      });

      for (const entry of entries) {
        await tx.auditLog.create({
          data: {
            userId: reviewerId,
            entityType: 'TIME_ENTRY',
            entityId: entry.id,
            action: AuditAction.REJECT,
            metadata: {
              reviewerId,
              rejectionReason: dto.rejectionReason,
              rejectedAt: new Date().toISOString(),
              hours: Number(entry.hours),
              workDate: this.formatDateString(entry.workDate),
            },
          },
        });

        await tx.notification.create({
          data: {
            userId: entry.userId,
            type: NotificationType.SYSTEM,
            title: 'Time Entry Rejected',
            message: `Your time entry for task "${entry.task.title}" was rejected. Reason: ${dto.rejectionReason}`,
            payload: {
              timeEntryId: entry.id,
              rejectedBy: reviewerId,
              rejectionReason: dto.rejectionReason,
            },
          },
        });
      }

      return {
        message: 'Time entries rejected',
        rejectedCount: entries.length,
        entryIds: dto.entryIds,
      };
    });
  }

  async getProjectSummary(
    projectId: string,
    userId: string,
    query: ProjectSummaryQueryDto,
  ) {
    await this.projectsService.assertProjectMember(projectId, userId);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, organizationId: true, status: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const whereClause: Prisma.TimeEntryWhereInput = {
      task: { projectId },
    };

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.startDate || query.endDate) {
      whereClause.workDate = {};
      if (query.startDate) {
        whereClause.workDate.gte = this.parseDateOnly(query.startDate);
      }
      if (query.endDate) {
        whereClause.workDate.lte = this.parseDateOnly(query.endDate);
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: whereClause,
      include: this.timeEntryInclude,
      orderBy: { workDate: 'asc' },
    });

    const formattedEntries = entries.map((e) => this.formatEntry(e));
    const totalHours = formattedEntries.reduce((sum, e) => sum + e.hours, 0);

    const hoursByStatus: Record<TimesheetStatus, number> = {
      [TimesheetStatus.DRAFT]: 0,
      [TimesheetStatus.SUBMITTED]: 0,
      [TimesheetStatus.APPROVED]: 0,
      [TimesheetStatus.REJECTED]: 0,
    };

    const userAgg = new Map<
      string,
      {
        userId: string;
        userName: string;
        email: string;
        totalHours: number;
        hoursByStatus: Record<TimesheetStatus, number>;
      }
    >();

    const taskAgg = new Map<
      string,
      {
        taskId: string;
        taskTitle: string;
        status: string;
        priority: string;
        totalHours: number;
      }
    >();

    const dailyTrendMap = new Map<string, number>();

    for (const e of formattedEntries) {
      hoursByStatus[e.status as TimesheetStatus] += e.hours;

      if (!userAgg.has(e.userId)) {
        userAgg.set(e.userId, {
          userId: e.userId,
          userName: e.user.name,
          email: e.user.email,
          totalHours: 0,
          hoursByStatus: {
            [TimesheetStatus.DRAFT]: 0,
            [TimesheetStatus.SUBMITTED]: 0,
            [TimesheetStatus.APPROVED]: 0,
            [TimesheetStatus.REJECTED]: 0,
          },
        });
      }
      const uItem = userAgg.get(e.userId)!;
      uItem.totalHours = Number((uItem.totalHours + e.hours).toFixed(2));
      uItem.hoursByStatus[e.status as TimesheetStatus] = Number(
        (uItem.hoursByStatus[e.status as TimesheetStatus] + e.hours).toFixed(2),
      );

      if (!taskAgg.has(e.taskId)) {
        taskAgg.set(e.taskId, {
          taskId: e.taskId,
          taskTitle: e.task.title,
          status: e.task.status,
          priority: e.task.priority,
          totalHours: 0,
        });
      }
      const tItem = taskAgg.get(e.taskId)!;
      tItem.totalHours = Number((tItem.totalHours + e.hours).toFixed(2));

      const curDateTotal = dailyTrendMap.get(e.workDate) || 0;
      dailyTrendMap.set(
        e.workDate,
        Number((curDateTotal + e.hours).toFixed(2)),
      );
    }

    const userBreakdown = Array.from(userAgg.values()).map((u) => ({
      ...u,
      percentage:
        totalHours > 0
          ? Number(((u.totalHours / totalHours) * 100).toFixed(2))
          : 0,
    }));

    const taskBreakdown = Array.from(taskAgg.values()).map((t) => ({
      ...t,
      percentage:
        totalHours > 0
          ? Number(((t.totalHours / totalHours) * 100).toFixed(2))
          : 0,
    }));

    const dailyTrend = Array.from(dailyTrendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }));

    return {
      project,
      dateRange: {
        startDate: query.startDate
          ? this.formatDateString(this.parseDateOnly(query.startDate))
          : null,
        endDate: query.endDate
          ? this.formatDateString(this.parseDateOnly(query.endDate))
          : null,
      },
      totalHours: Number(totalHours.toFixed(2)),
      hoursByStatus,
      userBreakdown,
      taskBreakdown,
      dailyTrend,
    };
  }

  async getUserSummary(
    targetUserIdOrMe: string | undefined,
    requesterId: string,
    query: UserSummaryQueryDto,
  ) {
    const targetUserId =
      !targetUserIdOrMe || targetUserIdOrMe === 'me'
        ? requesterId
        : targetUserIdOrMe;

    if (targetUserId !== requesterId) {
      await this.assertReviewerAccessToUser(requesterId, targetUserId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const whereClause: Prisma.TimeEntryWhereInput = {
      userId: targetUserId,
    };

    if (query.projectId) {
      await this.projectsService.assertProjectMember(
        query.projectId,
        requesterId,
      );
      whereClause.task = { projectId: query.projectId };
    }

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.startDate || query.endDate) {
      whereClause.workDate = {};
      if (query.startDate) {
        whereClause.workDate.gte = this.parseDateOnly(query.startDate);
      }
      if (query.endDate) {
        whereClause.workDate.lte = this.parseDateOnly(query.endDate);
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: whereClause,
      include: this.timeEntryInclude,
      orderBy: { workDate: 'asc' },
    });

    const formattedEntries = entries.map((e) => this.formatEntry(e));
    const totalHours = formattedEntries.reduce((sum, e) => sum + e.hours, 0);

    const hoursByStatus: Record<TimesheetStatus, number> = {
      [TimesheetStatus.DRAFT]: 0,
      [TimesheetStatus.SUBMITTED]: 0,
      [TimesheetStatus.APPROVED]: 0,
      [TimesheetStatus.REJECTED]: 0,
    };

    const projectAgg = new Map<
      string,
      { projectId: string; projectName: string; totalHours: number }
    >();
    const taskAgg = new Map<
      string,
      {
        taskId: string;
        taskTitle: string;
        projectId: string;
        projectName: string;
        totalHours: number;
      }
    >();
    const dailyDistributionMap = new Map<string, number>();

    for (const e of formattedEntries) {
      hoursByStatus[e.status as TimesheetStatus] += e.hours;

      const pid = e.task.projectId;
      if (!projectAgg.has(pid)) {
        projectAgg.set(pid, {
          projectId: pid,
          projectName: e.task.project.name,
          totalHours: 0,
        });
      }
      const pItem = projectAgg.get(pid)!;
      pItem.totalHours = Number((pItem.totalHours + e.hours).toFixed(2));

      if (!taskAgg.has(e.taskId)) {
        taskAgg.set(e.taskId, {
          taskId: e.taskId,
          taskTitle: e.task.title,
          projectId: pid,
          projectName: e.task.project.name,
          totalHours: 0,
        });
      }
      const tItem = taskAgg.get(e.taskId)!;
      tItem.totalHours = Number((tItem.totalHours + e.hours).toFixed(2));

      const cur = dailyDistributionMap.get(e.workDate) || 0;
      dailyDistributionMap.set(e.workDate, Number((cur + e.hours).toFixed(2)));
    }

    const projectBreakdown = Array.from(projectAgg.values()).map((p) => ({
      ...p,
      percentage:
        totalHours > 0
          ? Number(((p.totalHours / totalHours) * 100).toFixed(2))
          : 0,
    }));

    const taskBreakdown = Array.from(taskAgg.values());

    const dailyDistribution = Array.from(dailyDistributionMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }));

    return {
      user,
      dateRange: {
        startDate: query.startDate
          ? this.formatDateString(this.parseDateOnly(query.startDate))
          : null,
        endDate: query.endDate
          ? this.formatDateString(this.parseDateOnly(query.endDate))
          : null,
      },
      totalHours: Number(totalHours.toFixed(2)),
      hoursByStatus,
      projectBreakdown,
      taskBreakdown,
      dailyDistribution,
    };
  }

  async getAuditTrail(entryId: string, userId: string) {
    await this.findById(entryId, userId);

    const logs = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'TIME_ENTRY',
        entityId: entryId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      entryId,
      history: logs,
    };
  }

  private async assertReviewerAccessToUser(
    reviewerId: string,
    targetUserId: string,
  ): Promise<void> {
    const targetOrgMemberships = await this.prisma.organizationMember.findMany({
      where: { userId: targetUserId },
      select: { organizationId: true },
    });

    const targetOrgIds = targetOrgMemberships.map((m) => m.organizationId);

    const reviewerOrgAdmin = await this.prisma.organizationMember.findFirst({
      where: {
        userId: reviewerId,
        role: OrganizationRole.ADMIN,
        organizationId: { in: targetOrgIds },
      },
    });

    if (reviewerOrgAdmin) {
      return;
    }

    const targetProjects = await this.prisma.projectMember.findMany({
      where: { userId: targetUserId },
      select: { projectId: true },
    });

    const targetProjectIds = targetProjects.map((p) => p.projectId);

    const reviewerLeader = await this.prisma.projectMember.findFirst({
      where: {
        userId: reviewerId,
        projectId: { in: targetProjectIds },
        projectRole: {
          in: [ProjectRole.PROJECT_MANAGER, ProjectRole.TEAM_LEAD],
        },
      },
    });

    if (reviewerLeader) {
      return;
    }

    throw new ForbiddenException(
      'You do not have permission to view or review this user',
    );
  }
}
