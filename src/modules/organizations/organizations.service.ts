import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OrganizationRole, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          description: dto.description,
          createdById: userId,
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId,
          role: OrganizationRole.ADMIN,
        },
      });

      return this.getOrganizationById(organization.id, userId, tx);
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.organization.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            members: true,
            projects: true,
          },
        },
      },
    });
  }

  async getOrganizationById(
    organizationId: string,
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await this.assertMember(organizationId, userId, client);

    const organization = await client.organization.findUnique({
      where: {
        id: organizationId,
      },
      include: {
        _count: {
          select: {
            members: true,
            projects: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async update(
    organizationId: string,
    userId: string,
    dto: UpdateOrganizationDto,
  ) {
    await this.assertRole(organizationId, userId, [OrganizationRole.ADMIN]);

    try {
      return await this.prisma.organization.update({
        where: {
          id: organizationId,
        },
        data: dto,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Organization not found');
      }

      throw error;
    }
  }

  async addMember(
    organizationId: string,
    actorUserId: string,
    userId: string,
    role: OrganizationRole,
  ) {
    await this.assertRole(organizationId, actorUserId, [
      OrganizationRole.ADMIN,
    ]);

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new ConflictException('Cannot add an inactive user');
    }

    const existingMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (existingMember) {
      throw new ConflictException(
        'User is already a member of this organization',
      );
    }

    return this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  async listMembers(organizationId: string, userId: string) {
    await this.assertMember(organizationId, userId);

    return this.prisma.organizationMember.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        },
      },
    });
  }

  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
    role: OrganizationRole,
  ) {
    await this.assertRole(organizationId, actorUserId, [
      OrganizationRole.ADMIN,
    ]);

    const targetMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException('Organization member not found');
    }

    if (
      targetMember.role === OrganizationRole.ADMIN &&
      role !== OrganizationRole.ADMIN
    ) {
      const adminCount = await this.prisma.organizationMember.count({
        where: {
          organizationId,
          role: OrganizationRole.ADMIN,
        },
      });

      if (adminCount <= 1) {
        throw new ForbiddenException(
          'An organization must have at least one admin',
        );
      }
    }

    return this.prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
      data: {
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  async removeMember(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
  ) {
    await this.assertRole(organizationId, actorUserId, [
      OrganizationRole.ADMIN,
    ]);

    const targetMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException('Organization member not found');
    }

    if (targetMember.role === OrganizationRole.ADMIN) {
      const adminCount = await this.prisma.organizationMember.count({
        where: {
          organizationId,
          role: OrganizationRole.ADMIN,
        },
      });

      if (adminCount <= 1) {
        throw new ForbiddenException(
          'The final organization admin cannot be removed',
        );
      }
    }

    await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
    });

    return {
      message: 'Member removed successfully',
    };
  }

  async getMember(organizationId: string, userId: string) {
    return this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        },
      },
    });
  }

  async assertMember(
    organizationId: string,
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const member = await client.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    return member;
  }

  async assertRole(
    organizationId: string,
    userId: string,
    allowedRoles: OrganizationRole[],
  ) {
    const member = await this.assertMember(organizationId, userId);

    if (!allowedRoles.includes(member.role)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    return member;
  }
}
