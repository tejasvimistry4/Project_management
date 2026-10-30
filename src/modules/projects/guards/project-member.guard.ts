import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectsService } from '../projects.service';

@Injectable()
export class ProjectMemberGuard implements CanActivate {
  constructor(private readonly projectsService: ProjectsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const projectId = request.params.projectId;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!projectId) {
      return false;
    }

    const membership = await this.projectsService.assertProjectMember(
      projectId,
      user.id,
    );

    request.projectMembership = membership;

    return true;
  }
}
