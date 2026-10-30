import { Module } from '@nestjs/common';

import { PrismaModule } from '../../database/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [MilestonesController],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
