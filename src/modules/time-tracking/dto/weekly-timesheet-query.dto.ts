import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class WeeklyTimesheetQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId?: string;
}
