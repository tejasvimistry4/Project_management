import { Module } from '@nestjs/common';

import { PrismaModule } from '../../database/prisma.module';

import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationMemberGuard } from './guards/organization-member.guard';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationMemberGuard],
  exports: [OrganizationsService, OrganizationMemberGuard],
})
export class OrganizationsModule {}
