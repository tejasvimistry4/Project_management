import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

import { WsClientEvents } from '../constants/event.constants';

@Catch()
export class WsAllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    let message = 'Internal server error';
    let status = 500;

    if (exception instanceof WsException) {
      message = exception.getError() as string;
      status = 400;
    } else if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null && 'message' in res) {
        const resMessage = (res as { message: unknown }).message;
        message = Array.isArray(resMessage)
          ? resMessage.join(', ')
          : String(resMessage);
      } else {
        message = exception.message;
      }
      status = exception.getStatus();
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (client && typeof client.emit === 'function') {
      client.emit(WsClientEvents.ERROR, {
        event: WsClientEvents.ERROR,
        status,
        message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
