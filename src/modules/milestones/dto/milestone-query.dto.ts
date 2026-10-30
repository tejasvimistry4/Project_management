import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MilestoneStatus } from '@prisma/client';

export enum MilestoneSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  START_DATE = 'startDate',
  DUE_DATE = 'dueDate',
  NAME = 'name',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class MilestoneQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId?: string;

  @IsOptional()
  @IsEnum(MilestoneStatus, {
    message: 'status must be a valid MilestoneStatus',
  })
  status?: MilestoneStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isOverdue?: boolean;

  @IsOptional()
  @IsEnum(MilestoneSortBy)
  sortBy?: MilestoneSortBy = MilestoneSortBy.DUE_DATE;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.ASC;

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
