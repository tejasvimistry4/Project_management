import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApproveTimeEntriesDto,
  CreateTimeEntryDto,
  DailyTimesheetQueryDto,
  PendingApprovalsQueryDto,
  ProjectSummaryQueryDto,
  RejectTimeEntriesDto,
  SubmitTimesheetDto,
  TimeEntryQueryDto,
  UpdateTimeEntryDto,
  UserSummaryQueryDto,
  WeeklyTimesheetQueryDto,
} from './dto';
import { TimeTrackingService } from './time-tracking.service';

@Controller('time-entries')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class TimeTrackingController {
  constructor(private readonly timeTrackingService: TimeTrackingService) {}

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTimeEntryDto,
  ) {
    return this.timeTrackingService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: TimeEntryQueryDto,
  ) {
    return this.timeTrackingService.findAll(userId, query);
  }

  @Get('timesheet/daily')
  async getDailyTimesheet(
    @CurrentUser('id') userId: string,
    @Query() query: DailyTimesheetQueryDto,
  ) {
    return this.timeTrackingService.getDailyTimesheet(userId, query);
  }

  @Get('timesheet/weekly')
  async getWeeklyTimesheet(
    @CurrentUser('id') userId: string,
    @Query() query: WeeklyTimesheetQueryDto,
  ) {
    return this.timeTrackingService.getWeeklyTimesheet(userId, query);
  }

  @Post('timesheet/submit')
  async submitTimesheet(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitTimesheetDto,
  ) {
    return this.timeTrackingService.submitTimesheet(userId, dto);
  }

  @Post('timesheet/recall')
  async recallTimesheet(
    @CurrentUser('id') userId: string,
    @Body('entryIds') entryIds: string[],
  ) {
    return this.timeTrackingService.recallTimesheet(userId, entryIds);
  }

  @Get('approvals/pending')
  async getPendingApprovals(
    @CurrentUser('id') userId: string,
    @Query() query: PendingApprovalsQueryDto,
  ) {
    return this.timeTrackingService.getPendingApprovals(userId, query);
  }

  @Post('approvals/approve')
  async approveEntries(
    @CurrentUser('id') userId: string,
    @Body() dto: ApproveTimeEntriesDto,
  ) {
    return this.timeTrackingService.approveEntries(userId, dto);
  }

  @Post('approvals/reject')
  async rejectEntries(
    @CurrentUser('id') userId: string,
    @Body() dto: RejectTimeEntriesDto,
  ) {
    return this.timeTrackingService.rejectEntries(userId, dto);
  }

  @Get('summary/project/:projectId')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'time:project-summary' })
  async getProjectSummary(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ProjectSummaryQueryDto,
  ) {
    return this.timeTrackingService.getProjectSummary(projectId, userId, query);
  }

  @Get('summary/user{/:userId}')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'time:user-summary' })
  async getUserSummary(
    @CurrentUser('id') currentUserId: string,
    @Query() query: UserSummaryQueryDto,
    @Param('userId') targetUserId?: string,
  ) {
    return this.timeTrackingService.getUserSummary(
      targetUserId,
      currentUserId,
      query,
    );
  }

  @Get(':id')
  async findById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.timeTrackingService.findById(id, userId);
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTimeEntryDto,
  ) {
    return this.timeTrackingService.update(id, userId, dto);
  }

  @Delete(':id')
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.timeTrackingService.delete(id, userId);
  }

  @Get(':id/audit-trail')
  async getAuditTrail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.timeTrackingService.getAuditTrail(id, userId);
  }
}
