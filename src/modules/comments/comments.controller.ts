import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommentEntityType } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Controller('comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: CommentQueryDto,
  ) {
    return this.commentsService.findAll(userId, query);
  }

  @Get('task/:taskId')
  async findByTask(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Query() query: CommentQueryDto,
  ) {
    query.taskId = taskId;
    query.entityType = CommentEntityType.TASK;
    return this.commentsService.findAll(userId, query);
  }

  @Get('issue/:issueId')
  async findByIssue(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
    @Query() query: CommentQueryDto,
  ) {
    query.issueId = issueId;
    query.entityType = CommentEntityType.ISSUE;
    return this.commentsService.findAll(userId, query);
  }

  @Get('history/task/:taskId')
  async getTaskHistory(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.commentsService.getTaskHistory(taskId, userId, query);
  }

  @Get('history/issue/:issueId')
  async getIssueHistory(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.commentsService.getIssueHistory(issueId, userId, query);
  }

  @Get(':commentId')
  async findOne(
    @Param('commentId') commentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.commentsService.findById(commentId, userId);
  }

  @Patch(':commentId')
  async update(
    @Param('commentId') commentId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.update(commentId, userId, dto);
  }

  @Delete(':commentId')
  async delete(
    @Param('commentId') commentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.commentsService.delete(commentId, userId);
  }
}
