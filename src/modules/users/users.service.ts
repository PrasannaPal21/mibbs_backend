import { Injectable, NotFoundException } from '@nestjs/common';
import { Locale, UserStatus, type User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveMarketingGoals } from '../questionnaire/questionnaire.constants';

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

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { businessProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const bp = user.businessProfile;
    const marketingGoals = resolveMarketingGoals(bp?.marketingGoal);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneE164: user.phoneE164,
      businessProfile: bp
        ? {
            businessName: bp.businessName,
            industry: bp.industry,
            location: bp.location,
            yearsInBusiness: bp.yearsInBusiness,
            monthlyRevenue: bp.monthlyRevenue ? Number(bp.monthlyRevenue) : null,
            monthlyBudget: bp.monthlyBudget ? Number(bp.monthlyBudget) : null,
            marketingGoal: bp.marketingGoal,
            marketingGoals,
            targetAudience: bp.targetAudience,
            digitalMaturity: bp.digitalMaturity,
            salesChannel: bp.salesChannel,
            competitionLevel: bp.competitionLevel,
          }
        : null,
    };
  }

  async updateProfile(
    userId: string,
    dto: {
      name?: string;
      businessName?: string;
      industry?: string;
      location?: string;
      yearsInBusiness?: string;
      marketingGoal?: string;
    },
  ) {
    if (dto.name?.trim()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name.trim() },
      });
    }

    const bpFields = {
      businessName: dto.businessName?.trim(),
      industry: dto.industry?.trim(),
      location: dto.location?.trim(),
      yearsInBusiness: dto.yearsInBusiness?.trim(),
      marketingGoal: dto.marketingGoal?.trim(),
    };
    const hasBpUpdate = Object.values(bpFields).some((v) => v !== undefined);
    if (hasBpUpdate) {
      await this.prisma.businessProfile.upsert({
        where: { userId },
        create: { userId, ...bpFields },
        update: bpFields,
      });
    }

    return this.getProfile(userId);
  }
}
