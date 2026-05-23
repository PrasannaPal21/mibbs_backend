import { Injectable, NotFoundException } from '@nestjs/common';
import { Locale, UserStatus, type User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CreateUserInput {
  name: string;
  email: string;
  phoneE164?: string | null;
  passwordHash: string;
  locale?: Locale;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findByPhone(phoneE164: string) {
    return this.prisma.user.findUnique({ where: { phoneE164 } });
  }

  findByIdentifier(identifier: string) {
    if (identifier.includes('@')) return this.findByEmail(identifier);
    return this.findByPhone(identifier);
  }

  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  create(input: CreateUserInput) {
    return this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        phoneE164: input.phoneE164 ?? null,
        passwordHash: input.passwordHash,
        locale: input.locale ?? Locale.EN,
        status: UserStatus.ACTIVE,
        businessProfile: { create: {} },
      },
      include: { businessProfile: true },
    });
  }

  setLastLogin(id: string) {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  setPasswordHash(id: string, passwordHash: string) {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  markEmailVerified(id: string) {
    return this.prisma.user.update({ where: { id }, data: { emailVerified: new Date() } });
  }

  markPhoneVerified(id: string) {
    return this.prisma.user.update({ where: { id }, data: { phoneVerified: new Date() } });
  }
}
