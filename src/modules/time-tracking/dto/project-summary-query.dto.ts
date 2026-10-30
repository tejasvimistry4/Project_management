import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { TimesheetStatus } from '@prisma/client';

export class ProjectSummaryQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be a valid ISO date string' })
  endDate?: string;

  @IsOptional()
  @IsEnum(TimesheetStatus, {
    message: 'status must be a valid TimesheetStatus',
  })
  status?: TimesheetStatus;
}
