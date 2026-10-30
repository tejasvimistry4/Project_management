import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AppController } from './app.controller';

import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { CommentsModule } from './modules/comments/comments.module';
import { IssuesModule } from './modules/issues/issues.module';
import { SocketModule } from './modules/websockets/socket.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { RedisModule } from './common/redis/redis.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),

    RedisModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
    IssuesModule,
    SocketModule,
    MilestonesModule,
    TimeTrackingModule,
    AnalyticsModule,
    NotificationsModule,
    AuditLogsModule,
  ],

  controllers: [AppController],
})
export class AppModule {}
