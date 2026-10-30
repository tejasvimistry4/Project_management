import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '../../database/prisma.module';
import { EventsModule } from '../websockets/socket.module';
import { ProjectsModule } from '../projects/projects.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [PrismaModule, ProjectsModule, forwardRef(() => EventsModule)],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
