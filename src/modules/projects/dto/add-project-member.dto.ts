import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { ProjectRole } from '@prisma/client';

export class AddProjectMemberDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(ProjectRole)
  @IsNotEmpty()
  role: ProjectRole;
}
