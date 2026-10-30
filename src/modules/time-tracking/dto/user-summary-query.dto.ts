import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TimesheetStatus } from '@prisma/client';

export class UserSummaryQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be a valid ISO date string' })
  endDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId?: string;

  @IsOptional()
  @IsEnum(TimesheetStatus, {
    message: 'status must be a valid TimesheetStatus',
  })
  status?: TimesheetStatus;
}
