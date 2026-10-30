import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { OrganizationMemberGuard } from './guards/organization-member.guard';
import { OrganizationsService } from './organizations.service';

import { AddMemberDto } from './dto/add-member.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(userId, dto);
  }

  @Get()
  async findAll(@CurrentUser('id') userId: string) {
    return this.organizationsService.findAllForUser(userId);
  }

  @Get(':organizationId')
  @UseGuards(OrganizationMemberGuard)
  async findOne(
    @Param('organizationId') organizationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.organizationsService.getOrganizationById(
      organizationId,
      userId,
    );
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationMemberGuard)
  async update(
    @Param('organizationId') organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(organizationId, userId, dto);
  }

  @Get(':organizationId/members')
  @UseGuards(OrganizationMemberGuard)
  async listMembers(
    @Param('organizationId') organizationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.organizationsService.listMembers(organizationId, userId);
  }

  @Post(':organizationId/members')
  @UseGuards(OrganizationMemberGuard)
  async addMember(
    @Param('organizationId') organizationId: string,
    @CurrentUser('id') actorUserId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizationsService.addMember(
      organizationId,
      actorUserId,
      dto.userId,
      dto.role,
    );
  }

  @Patch(':organizationId/members/:userId')
  @UseGuards(OrganizationMemberGuard)
  async updateMemberRole(
    @Param('organizationId') organizationId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(
      organizationId,
      actorUserId,
      targetUserId,
      dto.role,
    );
  }

  @Delete(':organizationId/members/:userId')
  @UseGuards(OrganizationMemberGuard)
  async removeMember(
    @Param('organizationId') organizationId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.organizationsService.removeMember(
      organizationId,
      actorUserId,
      targetUserId,
    );
  }
}
