import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MilestoneStatus } from '@prisma/client';

export class CreateMilestoneDto {
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  @IsNotEmpty({ message: 'projectId is required' })
  projectId: string;

  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MinLength(2, { message: 'name must be at least 2 characters' })
  @MaxLength(200, { message: 'name cannot exceed 200 characters' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'description cannot exceed 5000 characters' })
  description?: string;

  @IsOptional()
  @IsDateString({}, { message: 'startDate must be an ISO date string' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'dueDate must be an ISO date string' })
  dueDate?: string;

  @IsOptional()
  @IsEnum(MilestoneStatus, {
    message: 'status must be a valid MilestoneStatus',
  })
  status?: MilestoneStatus;
}
