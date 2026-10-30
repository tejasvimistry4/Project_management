import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class DailyTimesheetQueryDto {
  @IsOptional()
  @IsDateString(
    {},
    { message: 'date must be a valid ISO date string (YYYY-MM-DD)' },
  )
  date?: string;

  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId?: string;
}
