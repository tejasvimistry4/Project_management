import { Controller, Get } from '@nestjs/common';

import { PrismaService } from './database/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getRoot() {
    return {
      success: true,
      message: 'Project Management API is running',
    };
  }

  @Get('health')
  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      success: true,
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}
