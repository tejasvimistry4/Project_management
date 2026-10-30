import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MilestoneStatus } from '@prisma/client';

export class UpdateMilestoneDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'name must be at least 2 characters' })
  @MaxLength(200, { message: 'name cannot exceed 200 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'description cannot exceed 5000 characters' })
  description?: string;

  @IsOptional()
  @IsDateString({}, { message: 'startDate must be an ISO date string' })
  startDate?: string | null;

  @IsOptional()
  @IsDateString({}, { message: 'dueDate must be an ISO date string' })
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(MilestoneStatus, {
    message: 'status must be a valid MilestoneStatus',
  })
  status?: MilestoneStatus;
}
