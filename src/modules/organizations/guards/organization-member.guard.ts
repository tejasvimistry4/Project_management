import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { OrganizationsService } from '../organizations.service';

export class OrganizationMemberGuard implements CanActivate {
  constructor(private readonly organizationsService: OrganizationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const user = request.user;
    const organizationId = request.params.organizationId;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!organizationId) {
      return false;
    }

    const membership = await this.organizationsService.assertMember(
      organizationId,
      user.id,
    );

    request.organizationMembership = membership;

    return true;
  }
}
