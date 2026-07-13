import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Intent, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationService } from '../../providers/notification/notification.service';
import type { CreateSpendDto } from './dto/create-spend.dto';
import {
  buildActualByChannel,
  buildPlannedByChannel,
  computeCompliance,
} from './spend-compliance.util';

interface PlanAllocation {
  key: string;
  label: string;
  intent: Intent;
  channels: Array<{ name: string; amount: number }>;
}

@Injectable()
export class SpendService {
  private readonly logger = new Logger(SpendService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService) {}

  private monthBounds(date = new Date()) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  async resolvePlan(userId: string, planId?: string) {
    const plan = planId
      ? await this.prisma.marketingPlan.findFirst({ where: { id: planId, userId } })
      : await this.prisma.marketingPlan.findFirst({
          where: { userId, isCurrent: true },
          orderBy: { generatedAt: 'desc' },
        });
    if (!plan) {
      throw new NotFoundException(
        planId ? 'Marketing plan not found' : 'No marketing plan found. Complete the questionnaire first.',
      );
    }
    return plan;
  }

  private getPlanChannels(allocations: unknown): string[] {
    const rows = allocations as unknown as PlanAllocation[];
    const set = new Set<string>();
    for (const row of rows) {
      for (const ch of row.channels ?? []) set.add(ch.name);
    }
    return [...set].sort();
  }

  private findIntentForChannel(allocations: unknown, channel: string): Intent | null {
    const rows = allocations as unknown as PlanAllocation[];
    for (const row of rows) {
      if (row.channels?.some((c) => c.name === channel)) return row.intent;
    }
    return null;
  }

  async create(userId: string, dto: CreateSpendDto) {
    const plan = await this.resolvePlan(userId, dto.planId);
    const channels = this.getPlanChannels(plan.allocations);
    if (!channels.includes(dto.channel)) {
      throw new BadRequestException(
        `Channel "${dto.channel}" is not in your plan. Choose: ${channels.join(', ')}`,
      );
    }

    const occurredOn = dto.occurredOn ? new Date(dto.occurredOn) : new Date();
    const intent = this.findIntentForChannel(plan.allocations, dto.channel);

    const log = await this.prisma.spendLog.create({
      data: {
        userId,
        planId: plan.id,
        channel: dto.channel,
        intent: intent ?? undefined,
        amount: dto.amount,
        occurredOn,
        note: dto.note?.trim() || null,
      },
    });

    // best-effort notification; do not block the API
    this.logger.debug(`Sending spend notification for user ${userId}: ₹${dto.amount} on ${dto.channel}`);
    try {
      await this.notifications.notifySpendLogged(userId, { amount: Number(dto.amount), channel: dto.channel });
    } catch (err) {
      this.logger.error(`Spend notification failed: ${(err as Error)?.message || err}`);
    }

    return this.formatLog(log);
  }

  async list(userId: string, planId?: string) {
    const plan = await this.resolvePlan(userId, planId);
    const logs = await this.prisma.spendLog.findMany({
      where: { userId, planId: plan.id },
      orderBy: { occurredOn: 'desc' },
      take: 100,
    });
    return {
      planId: plan.id,
      channels: this.getPlanChannels(plan.allocations),
      logs: logs.map((l) => this.formatLog(l)),
    };
  }

  async remove(userId: string, logId: string) {
    const log = await this.prisma.spendLog.findFirst({ where: { id: logId, userId } });
    if (!log) throw new NotFoundException('Spend log not found');
    await this.prisma.spendLog.delete({ where: { id: logId } });
    // best-effort notification about deletion
    this.logger.debug(`Sending spend removal notification for user ${userId}: ₹${log.amount} on ${log.channel}`);
    try {
      await this.notifications.notifySpendRemoved(userId, { amount: Number(log.amount), channel: log.channel });
    } catch (err) {
      this.logger.error(`Spend removal notification failed: ${(err as Error)?.message || err}`);
    }

    return { deleted: true };
  }

  async getCompliance(userId: string, planId?: string, month?: string) {
    const plan = await this.resolvePlan(userId, planId);
    const refDate = month ? new Date(`${month}-01`) : new Date();
    const { start, end } = this.monthBounds(refDate);

    const logs = await this.prisma.spendLog.findMany({
      where: {
        userId,
        planId: plan.id,
        occurredOn: { gte: start, lte: end },
      },
    });

    const allocations = plan.allocations as unknown as PlanAllocation[];
    const plannedByChannel = buildPlannedByChannel(allocations);
    const actualByChannel = buildActualByChannel(
      logs.map((l) => ({ channel: l.channel, amount: Number(l.amount) })),
    );
    const result = computeCompliance(plannedByChannel, actualByChannel);

    // Persist monthly snapshot atomically.  The composite unique
    // (userId, planId, periodStart) on ComplianceSnapshot makes this idempotent
    // under concurrent compliance reads.
    await this.prisma.complianceSnapshot.upsert({
      where: {
        userId_planId_periodStart: {
          userId,
          planId: plan.id,
          periodStart: start,
        },
      },
      create: {
        userId,
        planId: plan.id,
        periodStart: start,
        periodEnd: end,
        plannedJson: plannedByChannel as Prisma.InputJsonValue,
        actualJson: actualByChannel as Prisma.InputJsonValue,
        score: result.score,
      },
      update: {
        periodEnd: end,
        plannedJson: plannedByChannel as Prisma.InputJsonValue,
        actualJson: actualByChannel as Prisma.InputJsonValue,
        score: result.score,
      },
    });

    return {
      planId: plan.id,
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      monthlyBudget: Number(plan.monthlyBudget),
      ...result,
    };
  }

  private formatLog(log: {
    id: string;
    channel: string;
    intent: Intent | null;
    amount: Prisma.Decimal;
    occurredOn: Date;
    note: string | null;
    createdAt: Date;
  }) {
    return {
      id: log.id,
      channel: log.channel,
      intent: log.intent,
      amount: Number(log.amount),
      occurredOn: log.occurredOn.toISOString(),
      note: log.note,
      createdAt: log.createdAt.toISOString(),
    };
  }
}
