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
import { ProjectRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectRoles } from './decorators/project-roles.decorator';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { UpdateProjectMemberRoleDto } from './dto/update-project-member-role.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectMemberGuard } from './guards/project-member.guard';
import { ProjectRolesGuard } from './guards/project-roles.guard';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: QueryProjectDto,
  ) {
    return this.projectsService.findAllForUser(userId, query);
  }

  @Get(':projectId')
  @UseGuards(ProjectMemberGuard)
  async findOne(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.getProjectById(projectId, userId);
  }

  @Patch(':projectId')
  @UseGuards(ProjectMemberGuard, ProjectRolesGuard)
  @ProjectRoles(ProjectRole.PROJECT_MANAGER)
  async update(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(projectId, userId, dto);
  }

  @Patch(':projectId/archive')
  @UseGuards(ProjectMemberGuard, ProjectRolesGuard)
  @ProjectRoles(ProjectRole.PROJECT_MANAGER)
  async archive(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.archive(projectId, userId);
  }

  @Patch(':projectId/unarchive')
  @UseGuards(ProjectMemberGuard, ProjectRolesGuard)
  @ProjectRoles(ProjectRole.PROJECT_MANAGER)
  async unarchive(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.unarchive(projectId, userId);
  }

  @Delete(':projectId')
  @UseGuards(ProjectMemberGuard, ProjectRolesGuard)
  @ProjectRoles(ProjectRole.PROJECT_MANAGER)
  async delete(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.delete(projectId, userId);
  }

  @Get(':projectId/members')
  @UseGuards(ProjectMemberGuard)
  async listMembers(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.listMembers(projectId, userId);
  }

  @Post(':projectId/members')
  @UseGuards(ProjectMemberGuard, ProjectRolesGuard)
  @ProjectRoles(ProjectRole.PROJECT_MANAGER)
  async addMember(
    @Param('projectId') projectId: string,
    @CurrentUser('id') actorUserId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projectsService.addMember(
      projectId,
      actorUserId,
      dto.userId,
      dto.role,
    );
  }

  @Patch(':projectId/members/:userId')
  @UseGuards(ProjectMemberGuard, ProjectRolesGuard)
  @ProjectRoles(ProjectRole.PROJECT_MANAGER)
  async updateMemberRole(
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorUserId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
  ) {
    return this.projectsService.updateMemberRole(
      projectId,
      actorUserId,
      targetUserId,
      dto.role,
    );
  }

  @Delete(':projectId/members/:userId')
  @UseGuards(ProjectMemberGuard)
  async removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.projectsService.removeMember(
      projectId,
      actorUserId,
      targetUserId,
    );
  }
}
