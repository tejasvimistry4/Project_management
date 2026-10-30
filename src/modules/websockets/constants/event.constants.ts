export const WsClientEvents = {
  JOIN_PROJECT: 'join:project',
  LEAVE_PROJECT: 'leave:project',
  JOINED_PROJECT: 'joined:project',
  LEFT_PROJECT: 'left:project',

  COMMENT_CREATE: 'comment:create',
  COMMENT_UPDATE: 'comment:update',
  COMMENT_DELETE: 'comment:delete',

  COMMENT_CREATED_ACK: 'comment:created:ack',
  COMMENT_UPDATED_ACK: 'comment:updated:ack',
  COMMENT_DELETED_ACK: 'comment:deleted:ack',

  ISSUE_CREATE: 'issue:create',
  ISSUE_UPDATE_STATUS: 'issue:update_status',
  ISSUE_ASSIGN: 'issue:assign',
  ISSUE_DELETE: 'issue:delete',

  ISSUE_CREATED_ACK: 'issue:created:ack',
  ISSUE_STATUS_CHANGED_ACK: 'issue:status_changed:ack',
  ISSUE_ASSIGNED_ACK: 'issue:assigned:ack',
  ISSUE_DELETED_ACK: 'issue:deleted:ack',

  AUTHENTICATED: 'authenticated',
  ERROR: 'error',
} as const;

export const WsBroadcastEvents = {
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',

  ISSUE_CREATED: 'issue:created',
  ISSUE_UPDATED: 'issue:updated',
  ISSUE_STATUS_CHANGED: 'issue:status_changed',
  ISSUE_ASSIGNED: 'issue:assigned',
  ISSUE_DELETED: 'issue:deleted',
  NOTIFICATION_NEW: 'notification:new',
} as const;

export type WsClientEventType =
  (typeof WsClientEvents)[keyof typeof WsClientEvents];

export type WsBroadcastEventType =
  (typeof WsBroadcastEvents)[keyof typeof WsBroadcastEvents];
