import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CommentEntityType } from '@prisma/client';

export enum CommentSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class CommentQueryDto {
  @IsOptional()
  @IsEnum(CommentEntityType)
  entityType?: CommentEntityType;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  issueId?: string;

  @IsOptional()
  @IsEnum(CommentSortOrder)
  sortOrder?: CommentSortOrder = CommentSortOrder.ASC;

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
