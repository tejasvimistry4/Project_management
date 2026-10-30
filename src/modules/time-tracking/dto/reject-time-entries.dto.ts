import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RejectTimeEntriesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'entryIds cannot be empty' })
  @IsUUID('4', { each: true, message: 'Each entry ID must be a valid UUID' })
  entryIds: string[];

  @IsString()
  @IsNotEmpty({ message: 'rejectionReason is required' })
  @MinLength(3, { message: 'rejectionReason must be at least 3 characters' })
  @MaxLength(1000, { message: 'rejectionReason cannot exceed 1000 characters' })
  rejectionReason: string;
}
