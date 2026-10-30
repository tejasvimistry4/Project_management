import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RateLimit({ points: 30, duration: 60, keyPrefix: 'notifications:list' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notificationsService.findAll(userId, query);
  }

  @Get('unread-count')
  @RateLimit({
    points: 60,
    duration: 60,
    keyPrefix: 'notifications:unread-count',
  })
  async getUnreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 20, duration: 60, keyPrefix: 'notifications:read-all' })
  async markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Delete('read')
  @HttpCode(HttpStatus.OK)
  async deleteAllRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.deleteAllRead(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.delete(id, userId);
  }

  @Post('check-deadlines')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    points: 5,
    duration: 60,
    keyPrefix: 'notifications:check-deadlines',
  })
  async checkDeadlines() {
    return this.notificationsService.checkApproachingAndOverdueDeadlines();
  }
}
