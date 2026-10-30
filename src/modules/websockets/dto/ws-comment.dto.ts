import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class WsUpdateCommentDto {
  @IsNotEmpty({ message: 'commentId is required' })
  @IsUUID('4', { message: 'commentId must be a valid UUID' })
  commentId: string;

  @IsNotEmpty({ message: 'content cannot be empty' })
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  clientMutationId?: string;
}

export class WsDeleteCommentDto {
  @IsNotEmpty({ message: 'commentId is required' })
  @IsUUID('4', { message: 'commentId must be a valid UUID' })
  commentId: string;

  @IsOptional()
  @IsString()
  clientMutationId?: string;
}
