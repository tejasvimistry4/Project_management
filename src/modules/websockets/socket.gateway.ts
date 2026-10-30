import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  UseFilters,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { PrismaService } from '../../database/prisma.service';
import { CommentsService } from '../comments/comments.service';
import { CreateCommentDto } from '../comments/dto/create-comment.dto';
import { CreateIssueDto } from '../issues/dto/create-issue.dto';
import { IssuesService } from '../issues/issues.service';
import { ProjectsService } from '../projects/projects.service';
import { WsBroadcastEvents, WsClientEvents } from './constants/event.constants';
import {
  CommentDeletedPayload,
  IssueAssignedPayload,
  IssueDeletedPayload,
  IssueStatusChangedPayload,
  IssueUpdatedPayload,
} from './types/event.types';
import { extractBearerToken, generateUuid } from '../../utils/string.util';
import {
  JoinProjectDto,
  LeaveProjectDto,
  WsAssignIssueDto,
  WsDeleteCommentDto,
  WsDeleteIssueDto,
  WsUpdateCommentDto,
  WsUpdateIssueStatusDto,
} from './dto';
import { WsAllExceptionsFilter } from './filters/ws-exception.filter';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
@UseFilters(new WsAllExceptionsFilter())
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Inject(forwardRef(() => CommentsService))
    private readonly commentsService: CommentsService,
    @Inject(forwardRef(() => IssuesService))
    private readonly issuesService: IssuesService,
  ) {}

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake?.auth?.token;
    if (typeof authToken === 'string') {
      return extractBearerToken(authToken);
    }

    const authHeader = client.handshake?.headers?.authorization;
    if (typeof authHeader === 'string') {
      return extractBearerToken(authHeader);
    }

    const queryToken = client.handshake?.query?.token;
    if (typeof queryToken === 'string') {
      return extractBearerToken(queryToken);
    }

    return undefined;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(
          `Connection rejected: Missing auth token (socket ${client.id})`,
        );
        client.emit(WsClientEvents.ERROR, {
          event: WsClientEvents.ERROR,
          status: 401,
          message: 'Authentication token missing',
          timestamp: new Date().toISOString(),
        });
        client.disconnect(true);
        return;
      }

      const secret = this.configService.getOrThrow<string>('jwt.accessSecret');
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        type: string;
      }>(token, { secret });

      if (payload?.type !== 'access' || !payload?.sub) {
        this.logger.warn(
          `Connection rejected: Invalid token payload (socket ${client.id})`,
        );
        client.emit(WsClientEvents.ERROR, {
          event: WsClientEvents.ERROR,
          status: 401,
          message: 'Invalid access token',
          timestamp: new Date().toISOString(),
        });
        client.disconnect(true);
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
        },
      });

      if (!user || user.status !== 'ACTIVE') {
        this.logger.warn(
          `Connection rejected: User inactive or not found (socket ${client.id})`,
        );
        client.emit(WsClientEvents.ERROR, {
          event: WsClientEvents.ERROR,
          status: 401,
          message: 'User account not found or inactive',
          timestamp: new Date().toISOString(),
        });
        client.disconnect(true);
        return;
      }

      client.data.user = user;
      await client.join(`user:${user.id}`);
      this.logger.log(
        `Client authenticated: user ${user.id} (${user.email}), socket ${client.id}`,
      );

      client.emit(WsClientEvents.AUTHENTICATED, {
        event: WsClientEvents.AUTHENTICATED,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      this.logger.warn(
        `Connection rejected: Token verification failed (socket ${client.id})`,
      );
      client.emit(WsClientEvents.ERROR, {
        event: WsClientEvents.ERROR,
        status: 401,
        message: 'Invalid or expired authentication token',
        timestamp: new Date().toISOString(),
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data?.user as AuthenticatedUser | undefined;
    this.logger.log(
      `Client disconnected: socket ${client.id}${user ? ` (user ${user.id})` : ''}`,
    );
  }

  private getAuthenticatedUser(client: Socket): AuthenticatedUser {
    const user = client.data?.user as AuthenticatedUser | undefined;
    if (!user) {
      throw new WsException('Unauthorized: WebSocket client not authenticated');
    }
    return user;
  }

  @SubscribeMessage('join:project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: JoinProjectDto,
  ) {
    const user = this.getAuthenticatedUser(client);

    const member = await this.projectsService.assertProjectMember(
      dto.projectId,
      user.id,
    );

    const room = `project:${dto.projectId}`;
    await client.join(room);

    this.logger.log(`User ${user.id} joined room ${room}`);

    const result = {
      event: WsClientEvents.JOINED_PROJECT,
      projectId: dto.projectId,
      room,
      role: member.projectRole,
      clientMutationId: dto.clientMutationId,
      timestamp: new Date().toISOString(),
    };
    client.emit(WsClientEvents.JOINED_PROJECT, result);
    return result;
  }

  @SubscribeMessage('leave:project')
  async handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: LeaveProjectDto,
  ) {
    this.getAuthenticatedUser(client);
    const room = `project:${dto.projectId}`;
    await client.leave(room);

    const result = {
      event: WsClientEvents.LEFT_PROJECT,
      projectId: dto.projectId,
      room,
      timestamp: new Date().toISOString(),
    };
    client.emit(WsClientEvents.LEFT_PROJECT, result);
    return result;
  }

  @SubscribeMessage('comment:create')
  async handleCommentCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: CreateCommentDto & { clientMutationId?: string },
  ) {
    const user = this.getAuthenticatedUser(client);
    const comment = await this.commentsService.create(
      user.id,
      dto,
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.COMMENT_CREATED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: comment,
    };
    client.emit(WsClientEvents.COMMENT_CREATED_ACK, res);
    return res;
  }

  @SubscribeMessage('comment:update')
  async handleCommentUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WsUpdateCommentDto,
  ) {
    const user = this.getAuthenticatedUser(client);
    const comment = await this.commentsService.update(
      dto.commentId,
      user.id,
      { content: dto.content },
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.COMMENT_UPDATED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: comment,
    };
    client.emit(WsClientEvents.COMMENT_UPDATED_ACK, res);
    return res;
  }

  @SubscribeMessage('comment:delete')
  async handleCommentDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WsDeleteCommentDto,
  ) {
    const user = this.getAuthenticatedUser(client);
    const result = await this.commentsService.delete(
      dto.commentId,
      user.id,
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.COMMENT_DELETED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: result,
    };
    client.emit(WsClientEvents.COMMENT_DELETED_ACK, res);
    return res;
  }

  @SubscribeMessage('issue:create')
  async handleIssueCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: CreateIssueDto & { clientMutationId?: string },
  ) {
    const user = this.getAuthenticatedUser(client);
    const issue = await this.issuesService.create(
      user.id,
      dto,
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.ISSUE_CREATED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: issue,
    };
    client.emit(WsClientEvents.ISSUE_CREATED_ACK, res);
    return res;
  }

  @SubscribeMessage('issue:update_status')
  async handleIssueUpdateStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WsUpdateIssueStatusDto,
  ) {
    const user = this.getAuthenticatedUser(client);
    const issue = await this.issuesService.updateStatus(
      dto.issueId,
      user.id,
      dto.status,
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.ISSUE_STATUS_CHANGED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: issue,
    };
    client.emit(WsClientEvents.ISSUE_STATUS_CHANGED_ACK, res);
    return res;
  }

  @SubscribeMessage('issue:assign')
  async handleIssueAssign(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WsAssignIssueDto,
  ) {
    const user = this.getAuthenticatedUser(client);
    const issue = await this.issuesService.assign(
      dto.issueId,
      user.id,
      dto.assigneeId,
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.ISSUE_ASSIGNED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: issue,
    };
    client.emit(WsClientEvents.ISSUE_ASSIGNED_ACK, res);
    return res;
  }

  @SubscribeMessage('issue:delete')
  async handleIssueDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: WsDeleteIssueDto,
  ) {
    const user = this.getAuthenticatedUser(client);
    const result = await this.issuesService.delete(
      dto.issueId,
      user.id,
      dto.clientMutationId,
    );

    const res = {
      event: WsClientEvents.ISSUE_DELETED_ACK,
      status: 'success',
      clientMutationId: dto.clientMutationId,
      data: result,
    };
    client.emit(WsClientEvents.ISSUE_DELETED_ACK, res);
    return res;
  }

  emitCommentCreated(
    projectId: string,
    comment: unknown,
    clientMutationId?: string,
  ): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.COMMENT_CREATED, {
        event: WsBroadcastEvents.COMMENT_CREATED,
        eventId: generateUuid(),
        projectId,
        clientMutationId,
        data: comment,
        timestamp: new Date().toISOString(),
      });
  }

  emitCommentUpdated(
    projectId: string,
    comment: unknown,
    clientMutationId?: string,
  ): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.COMMENT_UPDATED, {
        event: WsBroadcastEvents.COMMENT_UPDATED,
        eventId: generateUuid(),
        projectId,
        clientMutationId,
        data: comment,
        timestamp: new Date().toISOString(),
      });
  }

  emitCommentDeleted(projectId: string, payload: CommentDeletedPayload): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.COMMENT_DELETED, {
        event: WsBroadcastEvents.COMMENT_DELETED,
        eventId: generateUuid(),
        projectId,
        clientMutationId: payload.clientMutationId,
        data: payload,
        timestamp: new Date().toISOString(),
      });
  }

  emitIssueCreated(
    projectId: string,
    issue: unknown,
    clientMutationId?: string,
  ): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.ISSUE_CREATED, {
        event: WsBroadcastEvents.ISSUE_CREATED,
        eventId: generateUuid(),
        projectId,
        clientMutationId,
        data: issue,
        timestamp: new Date().toISOString(),
      });
  }

  emitIssueUpdated(projectId: string, payload: IssueUpdatedPayload): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.ISSUE_UPDATED, {
        event: WsBroadcastEvents.ISSUE_UPDATED,
        eventId: generateUuid(),
        projectId,
        clientMutationId: payload.clientMutationId,
        data: payload.issue,
        changedFields: payload.changedFields,
        timestamp: new Date().toISOString(),
      });
  }

  emitIssueStatusChanged(
    projectId: string,
    payload: IssueStatusChangedPayload,
  ): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.ISSUE_STATUS_CHANGED, {
        event: WsBroadcastEvents.ISSUE_STATUS_CHANGED,
        eventId: generateUuid(),
        projectId,
        clientMutationId: payload.clientMutationId,
        data: payload,
        timestamp: new Date().toISOString(),
      });
  }

  emitIssueAssigned(projectId: string, payload: IssueAssignedPayload): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.ISSUE_ASSIGNED, {
        event: WsBroadcastEvents.ISSUE_ASSIGNED,
        eventId: generateUuid(),
        projectId,
        clientMutationId: payload.clientMutationId,
        data: payload,
        timestamp: new Date().toISOString(),
      });
  }

  emitIssueDeleted(projectId: string, payload: IssueDeletedPayload): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit(WsBroadcastEvents.ISSUE_DELETED, {
        event: WsBroadcastEvents.ISSUE_DELETED,
        eventId: generateUuid(),
        projectId,
        clientMutationId: payload.clientMutationId,
        data: payload,
        timestamp: new Date().toISOString(),
      });
  }

  emitNotification(userId: string, notification: any): void {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(WsBroadcastEvents.NOTIFICATION_NEW, {
      event: WsBroadcastEvents.NOTIFICATION_NEW,
      eventId: generateUuid(),
      userId,
      data: notification,
      timestamp: new Date().toISOString(),
    });
  }
}

export { SocketGateway as EventsGateway };
