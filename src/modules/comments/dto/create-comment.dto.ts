import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CommentEntityType } from '@prisma/client';

export class CreateCommentDto {
  @IsEnum(CommentEntityType)
  @IsNotEmpty()
  entityType: CommentEntityType;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  issueId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
