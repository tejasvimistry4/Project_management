import { Module } from '@nestjs/common';

import { PrismaModule } from '../../database/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { TimeTrackingController } from './time-tracking.controller';
import { TimeTrackingService } from './time-tracking.service';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService],
  exports: [TimeTrackingService],
})
export class TimeTrackingModule {}
