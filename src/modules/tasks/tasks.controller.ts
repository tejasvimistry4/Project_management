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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasksService.findAll(userId, query);
  }

  @Get(':taskId')
  async findOne(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.tasksService.findById(taskId, userId);
  }

  @Patch(':taskId')
  async update(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(taskId, userId, dto);
  }

  @Patch(':taskId/status')
  async updateStatus(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasksService.updateStatus(taskId, userId, dto.status);
  }

  @Patch(':taskId/assign')
  async assign(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasksService.assign(taskId, userId, dto.assigneeId ?? null);
  }

  @Delete(':taskId')
  async delete(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.tasksService.delete(taskId, userId);
  }

  @Get(':taskId/history')
  async getHistory(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.tasksService.getHistory(taskId, userId);
  }
}
