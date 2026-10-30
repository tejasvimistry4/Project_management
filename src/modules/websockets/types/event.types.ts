import {
  WsBroadcastEventType,
  WsClientEventType,
} from '../constants/event.constants';

export interface WsBroadcastEnvelope<T = unknown> {
  event: WsBroadcastEventType;
  eventId: string;
  projectId: string;
  clientMutationId?: string;
  data: T;
  timestamp: string;
  changedFields?: Record<string, unknown>;
}

export interface WsAckEnvelope<T = unknown> {
  event: WsClientEventType;
  status: 'success' | 'error';
  clientMutationId?: string;
  data: T;
}

export interface CommentDeletedPayload {
  commentId: string;
  entityType: string;
  taskId?: string | null;
  issueId?: string | null;
  deletedBy: string;
  clientMutationId?: string;
}

export interface IssueUpdatedPayload {
  issue: unknown;
  changedFields?: Record<string, unknown>;
  clientMutationId?: string;
}

export interface IssueStatusChangedPayload {
  issueId: string;
  oldStatus: string;
  newStatus: string;
  issue: unknown;
  clientMutationId?: string;
}

export interface IssueAssignedPayload {
  issueId: string;
  oldAssigneeId: string | null;
  newAssigneeId: string | null;
  issue: unknown;
  clientMutationId?: string;
}

export interface IssueDeletedPayload {
  issueId: string;
  deletedBy: string;
  clientMutationId?: string;
}

export interface WsErrorEnvelope {
  event: 'error';
  status: number;
  message: string;
  timestamp: string;
}
