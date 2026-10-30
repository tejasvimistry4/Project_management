import { ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

export class LinkMilestoneTasksDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'taskIds cannot be an empty array' })
  @IsUUID('4', {
    each: true,
    message: 'each item in taskIds must be a valid UUID',
  })
  taskIds?: string[];

  @IsOptional()
  @IsUUID('4', { message: 'taskId must be a valid UUID' })
  taskId?: string;
}
