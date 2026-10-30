import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { LinkMilestoneTasksDto } from './dto/link-milestone-tasks.dto';
import { MilestoneQueryDto } from './dto/milestone-query.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { MilestonesService } from './milestones.service';

@Controller('milestones')
@UseGuards(JwtAuthGuard)
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.milestonesService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: MilestoneQueryDto,
  ) {
    return this.milestonesService.findAll(userId, query);
  }

  @Get(':milestoneId')
  async findOne(
    @Param('milestoneId', new ParseUUIDPipe({ version: '4' }))
    milestoneId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.milestonesService.findById(milestoneId, userId);
  }

  @Patch(':milestoneId')
  async update(
    @Param('milestoneId', new ParseUUIDPipe({ version: '4' }))
    milestoneId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.milestonesService.update(milestoneId, userId, dto);
  }

  @Delete(':milestoneId')
  async delete(
    @Param('milestoneId', new ParseUUIDPipe({ version: '4' }))
    milestoneId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.milestonesService.delete(milestoneId, userId);
  }

  @Post(':milestoneId/tasks')
  async linkTasks(
    @Param('milestoneId', new ParseUUIDPipe({ version: '4' }))
    milestoneId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: LinkMilestoneTasksDto,
  ) {
    return this.milestonesService.linkTasks(milestoneId, userId, dto);
  }

  @Delete(':milestoneId/tasks/:taskId')
  async unlinkTask(
    @Param('milestoneId', new ParseUUIDPipe({ version: '4' }))
    milestoneId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.milestonesService.unlinkTask(milestoneId, taskId, userId);
  }
}
