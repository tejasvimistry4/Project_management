import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../../database/prisma.service';
import {
  compareHash,
  generateRandomToken,
  hashString,
  sanitizeEmail,
} from '../../utils';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly auditLogsService?: AuditLogsService,
  ) {}

  async register(dto: RegisterDto) {
    await this.usersService.ensureEmailAvailable(dto.email);

    const passwordHash = await hashString(dto.password, this.saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email: sanitizeEmail(dto.email),
        name: dto.name,
        passwordHash,
        role: dto.role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await compareHash(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active');
    }

    void this.auditLogsService?.record({
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'AUTH',
      entityId: user.id,
      metadata: {
        email: user.email,
      },
    });

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: {
      sub: string;
      type: string;
    };

    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const storedTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: payload.sub,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    let matchingToken: (typeof storedTokens)[number] | undefined;

    for (const storedToken of storedTokens) {
      const matches = await compareHash(refreshToken, storedToken.tokenHash);

      if (matches) {
        matchingToken = storedToken;
        break;
      }
    }

    if (!matchingToken) {
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active');
    }

    await this.prisma.refreshToken.update({
      where: {
        id: matchingToken.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return this.issueTokens(user);
  }

  async logout(refreshToken: string) {
    const storedTokens = await this.prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
      },
    });

    for (const storedToken of storedTokens) {
      const matches = await compareHash(refreshToken, storedToken.tokenHash);

      if (matches) {
        await this.prisma.refreshToken.update({
          where: {
            id: storedToken.id,
          },
          data: {
            revokedAt: new Date(),
          },
        });

        break;
      }
    }

    return {
      message: 'Logged out successfully',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      return {
        message:
          'If an account exists for this email, a password reset link will be generated.',
      };
    }

    const rawToken = generateRandomToken(32);

    const tokenHash = await hashString(rawToken, this.saltRounds);

    const expiresInMinutes = this.configService.getOrThrow<number>(
      'passwordReset.expiresInMinutes',
    );

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      message:
        'If an account exists for this email, a password reset link will be generated.',
      resetToken: rawToken,
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const resetTokens = await this.prisma.passwordResetToken.findMany({
      where: {
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    let matchingToken: (typeof resetTokens)[number] | undefined;

    for (const resetToken of resetTokens) {
      const matches = await compareHash(token, resetToken.tokenHash);

      if (matches) {
        matchingToken = resetToken;
        break;
      }
    }

    if (!matchingToken) {
      throw new UnauthorizedException(
        'Invalid or expired password reset token',
      );
    }

    const passwordHash = await hashString(newPassword, this.saltRounds);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: matchingToken.userId,
        },
        data: {
          passwordHash,
        },
      });

      await tx.passwordResetToken.update({
        where: {
          id: matchingToken.id,
        },
        data: {
          usedAt: new Date(),
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: matchingToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      await this.auditLogsService?.record(
        {
          userId: matchingToken.userId,
          action: AuditAction.PASSWORD_RESET,
          entityType: 'USER',
          entityId: matchingToken.userId,
        },
        tx,
      );
    });

    return {
      message: 'Password has been reset successfully',
    };
  }

  private async issueTokens(user: { id: string; email: string; role: string }) {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'access',
      },
      {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.configService.getOrThrow<any>('jwt.accessExpiresIn'),
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        type: 'refresh',
        tokenId: generateRandomToken(16),
      },
      {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.getOrThrow<any>('jwt.refreshExpiresIn'),
      },
    );

    const refreshTokenHash = await hashString(refreshToken, this.saltRounds);

    const decoded = this.jwtService.decode(refreshToken) as {
      exp?: number;
    };

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: new Date((decoded.exp ?? 0) * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
    };
  }
}
