import { BadRequestException } from '@nestjs/common';
import { Prisma, ProjectMember } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

export async function assertProjectAssignee(
  prisma: PrismaService | Prisma.TransactionClient,
  projectId: string,
  assigneeId: string,
): Promise<ProjectMember> {
  const assigneeMember = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: assigneeId,
      },
    },
  });

  if (!assigneeMember) {
    throw new BadRequestException(
      'Assignee must be an active member of this project',
    );
  }

  return assigneeMember;
}
