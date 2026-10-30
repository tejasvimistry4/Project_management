import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class JoinProjectDto {
  @IsNotEmpty({ message: 'projectId is required' })
  @IsUUID('4', { message: 'projectId must be a valid UUID' })
  projectId: string;

  @IsOptional()
  @IsString()
  clientMutationId?: string;
}
