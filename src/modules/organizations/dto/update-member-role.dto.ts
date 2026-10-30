import { IsEnum } from 'class-validator';
import { OrganizationRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  @IsEnum(OrganizationRole)
  role: OrganizationRole;
}
