import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'audit-logs:list' })
  async findAll(
    @CurrentUser() user: { id: string; role: UserRole },
    @Query() query: QueryAuditLogsDto,
  ) {
    return this.auditLogsService.findAll(query, user.id, user.role);
  }

  @Get('my-activity')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'audit-logs:my-activity' })
  async findMyActivity(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.auditLogsService.findMyActivity(userId, { page, limit });
  }

  @Get('projects/:projectId')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'audit-logs:project' })
  async findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.auditLogsService.findByProject(projectId, user.id, user.role, {
      page,
      limit,
    });
  }

  @Get('entities/:entityType/:entityId')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'audit-logs:entity' })
  async findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.auditLogsService.findByEntity(entityType, entityId);
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.auditLogsService.findById(id, user.id, user.role);
  }
}
