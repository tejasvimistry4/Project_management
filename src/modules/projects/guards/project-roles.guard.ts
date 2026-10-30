import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectRole } from '@prisma/client';
import { PROJECT_ROLES_KEY } from '../decorators/project-roles.decorator';
import { ProjectsService } from '../projects.service';

@Injectable()
export class ProjectRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projectsService: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<ProjectRole[]>(
      PROJECT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const projectId = request.params.projectId;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!projectId) {
      throw new ForbiddenException('Project ID parameter is required');
    }

    const membership = await this.projectsService.assertProjectRole(
      projectId,
      user.id,
      requiredRoles,
    );

    request.projectMembership = membership;

    return true;
  }
}
