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
import { AssignIssueDto } from './dto/assign-issue.dto';
import { CreateIssueDto } from './dto/create-issue.dto';
import { IssueQueryDto } from './dto/issue-query.dto';
import { UpdateIssueStatusDto } from './dto/update-issue-status.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { IssuesService } from './issues.service';

@Controller('issues')
@UseGuards(JwtAuthGuard)
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post()
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateIssueDto) {
    return this.issuesService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: IssueQueryDto,
  ) {
    return this.issuesService.findAll(userId, query);
  }

  @Get(':issueId')
  async findOne(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.issuesService.findById(issueId, userId);
  }

  @Patch(':issueId')
  async update(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateIssueDto,
  ) {
    return this.issuesService.update(issueId, userId, dto);
  }

  @Patch(':issueId/status')
  async updateStatus(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateIssueStatusDto,
  ) {
    return this.issuesService.updateStatus(issueId, userId, dto.status);
  }

  @Patch(':issueId/assign')
  async assign(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AssignIssueDto,
  ) {
    return this.issuesService.assign(issueId, userId, dto.assigneeId ?? null);
  }

  @Delete(':issueId')
  async delete(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.issuesService.delete(issueId, userId);
  }

  @Get(':issueId/history')
  async getHistory(
    @Param('issueId') issueId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.issuesService.getHistory(issueId, userId);
  }
}
