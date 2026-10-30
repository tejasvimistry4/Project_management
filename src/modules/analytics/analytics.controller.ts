import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('projects/:projectId/dashboard')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'analytics:dashboard' })
  async getProjectDashboard(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.analyticsService.getProjectDashboard(projectId, userId);
  }

  @Get('projects/:projectId/workload')
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'analytics:workload' })
  async getProjectWorkload(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.analyticsService.getProjectWorkload(projectId, userId);
  }
}
