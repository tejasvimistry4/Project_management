import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignTaskDto {
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;
}
