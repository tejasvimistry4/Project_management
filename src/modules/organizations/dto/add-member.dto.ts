import { IsEnum, IsUUID } from 'class-validator';

import { OrganizationRole } from '@prisma/client';

export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsEnum(OrganizationRole)
  role: OrganizationRole;
}
