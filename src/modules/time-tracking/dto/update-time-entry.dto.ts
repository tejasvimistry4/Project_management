import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsUUID('4', { message: 'taskId must be a valid UUID' })
  taskId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'hours must be a valid number with up to 2 decimal places' },
  )
  @Min(0.1, { message: 'hours must be at least 0.1' })
  @Max(24, { message: 'hours cannot exceed 24 per entry' })
  hours?: number;

  @IsOptional()
  @IsDateString({}, { message: 'workDate must be a valid ISO date string' })
  workDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'notes cannot exceed 1000 characters' })
  notes?: string;
}
