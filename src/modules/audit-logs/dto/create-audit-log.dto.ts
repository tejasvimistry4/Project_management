import { AuditAction } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAuditLogDto {
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsEnum(AuditAction)
  @IsNotEmpty()
  action: AuditAction;

  @IsString()
  @IsNotEmpty()
  entityType: string;

  @IsUUID()
  @IsNotEmpty()
  entityId: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @IsOptional()
  metadata?: Record<string, any> | null;
}
