import { IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class SubmitTimesheetDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each entry ID must be a valid UUID' })
  entryIds?: string[];

  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be a valid ISO date string' })
  endDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId?: string;
}
