import { IsNotEmpty, IsUUID } from 'class-validator';

export class LeaveProjectDto {
  @IsNotEmpty({ message: 'projectId is required' })
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId: string;
}
