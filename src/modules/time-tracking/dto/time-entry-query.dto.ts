import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TimesheetStatus } from '@prisma/client';

export enum TimeEntrySortBy {
  WORK_DATE = 'workDate',
  HOURS = 'hours',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class TimeEntryQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'taskId must be a valid UUID' })
  taskId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @IsOptional()
  @IsEnum(TimesheetStatus, {
    message: 'status must be a valid TimesheetStatus',
  })
  status?: TimesheetStatus;

  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be a valid ISO date string' })
  endDate?: string;

  @IsOptional()
  @IsEnum(TimeEntrySortBy)
  sortBy?: TimeEntrySortBy = TimeEntrySortBy.WORK_DATE;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
