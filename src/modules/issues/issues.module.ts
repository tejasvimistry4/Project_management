import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '../../database/prisma.module';
import { EventsModule } from '../websockets/socket.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';

@Module({
  imports: [
    PrismaModule,
    ProjectsModule,
    forwardRef(() => EventsModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
