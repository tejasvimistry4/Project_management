import { Module } from '@nestjs/common';

import { PrismaModule } from '../../database/prisma.module';
import { ProjectMemberGuard } from './guards/project-member.guard';
import { ProjectRolesGuard } from './guards/project-roles.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectMemberGuard, ProjectRolesGuard],
  exports: [ProjectsService, ProjectMemberGuard, ProjectRolesGuard],
})
export class ProjectsModule {}
