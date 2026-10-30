import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ApproveTimeEntriesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'entryIds cannot be empty' })
  @IsUUID('4', { each: true, message: 'Each entry ID must be a valid UUID' })
  entryIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'comment cannot exceed 500 characters' })
  comment?: string;
}
