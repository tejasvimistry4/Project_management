import { IsEnum, IsNotEmpty } from 'class-validator';
import { IssueStatus } from '@prisma/client';

export class UpdateIssueStatusDto {
  @IsEnum(IssueStatus)
  @IsNotEmpty()
  status: IssueStatus;
}
