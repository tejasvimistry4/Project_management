import { IsEnum, IsNotEmpty } from 'class-validator';
import { ProjectRole } from '@prisma/client';

export class UpdateProjectMemberRoleDto {
  @IsEnum(ProjectRole)
  @IsNotEmpty()
  role: ProjectRole;
}
