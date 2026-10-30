import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IssueStatus } from '@prisma/client';

export class WsUpdateIssueStatusDto {
  @IsNotEmpty({ message: 'issueId is required' })
  @IsUUID('4', { message: 'issueId must be a valid UUID' })
  issueId: string;

  @IsNotEmpty({ message: 'status is required' })
  @IsEnum(IssueStatus, { message: 'status must be a valid IssueStatus' })
  status: IssueStatus;

  @IsOptional()
  @IsString()
  clientMutationId?: string;
}

export class WsAssignIssueDto {
  @IsNotEmpty({ message: 'issueId is required' })
  @IsUUID('4', { message: 'issueId must be a valid UUID' })
  issueId: string;

  @IsOptional()
  @IsUUID('4', { message: 'assigneeId must be a valid UUID' })
  assigneeId: string | null;

  @IsOptional()
  @IsString()
  clientMutationId?: string;
}

export class WsDeleteIssueDto {
  @IsNotEmpty({ message: 'issueId is required' })
  @IsUUID('4', { message: 'issueId must be a valid UUID' })
  issueId: string;

  @IsOptional()
  @IsString()
  clientMutationId?: string;
}
