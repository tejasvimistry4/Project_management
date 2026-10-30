import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { PrismaModule } from '../../database/prisma.module';
import { CommentsModule } from '../comments/comments.module';
import { IssuesModule } from '../issues/issues.module';
import { ProjectsModule } from '../projects/projects.module';
import { SocketGateway } from './socket.gateway';

@Module({
  imports: [
    JwtModule.register({}),
    ConfigModule,
    PrismaModule,
    ProjectsModule,
    forwardRef(() => CommentsModule),
    forwardRef(() => IssuesModule),
  ],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}

export { SocketModule as EventsModule };
