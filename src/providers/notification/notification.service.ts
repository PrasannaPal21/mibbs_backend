import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms.interface';
import { WHATSAPP_PROVIDER, type WhatsappProvider } from '../whatsapp/whatsapp.interface';
import { EMAIL_PROVIDER, type EmailProvider } from '../email/email.interface';
import { NotificationChannel, NotificationStatus } from '@prisma/client';

type NotificationPlanBudget = { monthlyBudget: number; annualBudget: number };

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  private async recordNotification(options: {
    userId: string;
    channel: NotificationChannel;
    template: string;
    body: string;
    to: string;
    status: NotificationStatus;
    data?: unknown;
    error?: string;
  }) {
    try {
      await this.prisma.notification.create({
        data: {
          userId: options.userId,
          channel: options.channel,
          template: options.template,
          payload: {
            body: options.body,
            to: options.to,
            data: options.data ?? null,
          },
          status: options.status,
          error: options.error,
          sentAt: options.status === NotificationStatus.SENT ? new Date() : undefined,
        },
      });
    } catch (err) {
      this.logger.error('Failed to record notification', err);
    }
  }

  // ──────────────────────────────────────────────
  //  SMS
  // ──────────────────────────────────────────────

  private async sendToUser(userId: string, body: string, tag?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const phone = user?.phoneE164;
    const template = tag ?? 'sms';

    if (!phone) {
      this.logger.warn(`User ${userId} has no phone number; skipping SMS`);
      await this.recordNotification({
        userId,
        channel: NotificationChannel.SMS,
        template,
        body,
        to: '',
        status: NotificationStatus.FAILED,
        error: 'no-phone',
      });
      return { success: false, reason: 'no-phone' };
    }

    try {
      const result = await this.sms.send({ to: phone, body, tag });
      const status = result.success ? NotificationStatus.SENT : NotificationStatus.FAILED;
      await this.recordNotification({
        userId,
        channel: NotificationChannel.SMS,
        template,
        body,
        to: phone,
        status,
        data: result.data,
        error: result.success ? undefined : 'send-failed',
      });
      if (!result.success) {
        this.logger.warn(`SMS send failed for user ${userId}: ${JSON.stringify(result.data)}`);
      }
      return result;
    } catch (err) {
      this.logger.error('SMS send error', err);
      await this.recordNotification({
        userId,
        channel: NotificationChannel.SMS,
        template,
        body,
        to: phone,
        status: NotificationStatus.FAILED,
        data: err,
        error: (err as Error)?.message || String(err),
      });
      return { success: false, data: err };
    }
  }

  // ──────────────────────────────────────────────
  //  WhatsApp
  // ──────────────────────────────────────────────

  private async sendWhatsappToUser(userId: string, body: string, tag?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const phone = user?.phoneE164;
    const template = tag ?? 'whatsapp';

    if (!phone) {
      this.logger.warn(`User ${userId} has no phone number; skipping WhatsApp`);
      await this.recordNotification({
        userId,
        channel: NotificationChannel.WHATSAPP,
        template,
        body,
        to: '',
        status: NotificationStatus.FAILED,
        error: 'no-phone',
      });
      return { success: false, reason: 'no-phone' };
    }

    try {
      const result = await this.whatsapp.send({ to: phone, body, tag });
      const status = result.success ? NotificationStatus.SENT : NotificationStatus.FAILED;
      await this.recordNotification({
        userId,
        channel: NotificationChannel.WHATSAPP,
        template,
        body,
        to: phone,
        status,
        data: result.data,
        error: result.success ? undefined : 'send-failed',
      });
      if (!result.success) {
        this.logger.warn(`WhatsApp send failed for user ${userId}: ${JSON.stringify(result.data)}`);
      }
      return result;
    } catch (err) {
      this.logger.error('WhatsApp send error', err);
      await this.recordNotification({
        userId,
        channel: NotificationChannel.WHATSAPP,
        template,
        body,
        to: phone,
        status: NotificationStatus.FAILED,
        data: err,
        error: (err as Error)?.message || String(err),
      });
      return { success: false, data: err };
    }
  }

  // ──────────────────────────────────────────────
  //  Email
  // ──────────────────────────────────────────────

  private async sendEmailToUser(
    userId: string,
    subject: string,
    html: string,
    text: string,
    tag?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const emailAddr = user?.email;
    const template = tag ?? 'email';

    if (!emailAddr) {
      this.logger.warn(`User ${userId} has no email address; skipping email`);
      await this.recordNotification({
        userId,
        channel: NotificationChannel.EMAIL,
        template,
        body: subject,
        to: '',
        status: NotificationStatus.FAILED,
        error: 'no-email',
      });
      return { success: false, reason: 'no-email' };
    }

    try {
      const result = await this.email.send({
        to: emailAddr,
        subject,
        html,
        text,
        tag,
      });
      const status = result.accepted ? NotificationStatus.SENT : NotificationStatus.FAILED;
      await this.recordNotification({
        userId,
        channel: NotificationChannel.EMAIL,
        template,
        body: subject,
        to: emailAddr,
        status,
        data: result,
        error: result.accepted ? undefined : 'send-failed',
      });
      if (!result.accepted) {
        this.logger.warn(`Email send failed for user ${userId}`);
      }
      return result;
    } catch (err) {
      this.logger.error('Email send error', err);
      await this.recordNotification({
        userId,
        channel: NotificationChannel.EMAIL,
        template,
        body: subject,
        to: emailAddr,
        status: NotificationStatus.FAILED,
        data: err,
        error: (err as Error)?.message || String(err),
      });
      return { success: false, data: err };
    }
  }

  private emailWrapper(bodyHtml: string): string {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f5f5f5">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:24px 0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
            <!-- Header -->
            <tr>
              <td style="background:#6D28D9;padding:24px 32px;text-align:center">
                <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">MIBBS</h1>
                <p style="margin:4px 0 0;color:#c4b5fd;font-size:13px">Smart Business Growth</p>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:32px">
                ${bodyHtml}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
                <p style="margin:0;color:#9ca3af;font-size:12px">MIBBS — AI-powered marketing for Indian small businesses</p>
                <p style="margin:4px 0 0;color:#9ca3af;font-size:11px">If you have any questions, contact us at support@mibbs.app</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  // ──────────────────────────────────────────────
  //  Notifications
  // ──────────────────────────────────────────────

  async notifyPlanGenerated(userId: string, plan: NotificationPlanBudget) {
    const smsBody = `MIBBS: Your marketing plan is ready. Monthly budget ₹${plan.monthlyBudget}, Annual ₹${plan.annualBudget}.`;
    const res = await this.sendToUser(userId, smsBody, 'plan_generated');
    // Best-effort WhatsApp notification as well
    try {
      await this.sendWhatsappToUser(userId, smsBody, 'plan_generated');
    } catch (err) {
      // ignore whatsapp errors
    }
    // Best-effort email notification
    try {
      await this.sendEmailToUser(
        userId,
        'Your MIBBS Marketing Plan is Ready',
        this.emailWrapper(`
          <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">Your Marketing Plan is Ready 🎉</h2>
          <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">Your personalised marketing plan has been generated based on your business profile and goals.</p>
          <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin-bottom:20px">
            <tr>
              <td style="border-bottom:1px solid #e5e7eb">
                <span style="color:#6b7280;font-size:13px">Monthly Budget</span>
                <div style="color:#1f2937;font-size:20px;font-weight:700">₹${plan.monthlyBudget.toLocaleString('en-IN')}</div>
              </td>
            </tr>
            <tr>
              <td>
                <span style="color:#6b7280;font-size:13px">Annual Budget</span>
                <div style="color:#1f2937;font-size:20px;font-weight:700">₹${plan.annualBudget.toLocaleString('en-IN')}</div>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;color:#6b7280;font-size:14px">Log in to your dashboard to view the full channel allocation and action plan.</p>
          <p style="margin:0;color:#6b7280;font-size:14px">— The MIBBS Team</p>
        `),
        smsBody,
        'plan_generated',
      );
    } catch (err) {
      // ignore email errors
    }
    return res;
  }

  async notifySpendLogged(userId: string, log: { amount: number; channel: string }) {
    const smsBody = `MIBBS: Spend recorded ₹${log.amount} on ${log.channel}.`;
    const res = await this.sendToUser(userId, smsBody, 'spend_logged');
    // Best-effort WhatsApp
    try {
      await this.sendWhatsappToUser(userId, smsBody, 'spend_logged');
    } catch (err) {
      // ignore whatsapp errors
    }
    // Best-effort email
    try {
      await this.sendEmailToUser(
        userId,
        `Spend Recorded — ₹${log.amount.toLocaleString('en-IN')} on ${log.channel}`,
        this.emailWrapper(`
          <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">Spend Recorded ✅</h2>
          <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">A new marketing expense has been logged in your account.</p>
          <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin-bottom:20px">
            <tr>
              <td style="border-bottom:1px solid #e5e7eb">
                <span style="color:#6b7280;font-size:13px">Amount</span>
                <div style="color:#1f2937;font-size:20px;font-weight:700">₹${log.amount.toLocaleString('en-IN')}</div>
              </td>
            </tr>
            <tr>
              <td>
                <span style="color:#6b7280;font-size:13px">Channel</span>
                <div style="color:#1f2937;font-size:16px;font-weight:600">${log.channel}</div>
              </td>
            </tr>
          </table>
          <p style="margin:0;color:#6b7280;font-size:14px">Track all your expenses and budget compliance on your MIBBS dashboard.</p>
        `),
        smsBody,
        'spend_logged',
      );
    } catch (err) {
      // ignore email errors
    }
    return res;
  }

  async notifyCampaignPlaceholder(userId: string, title?: string) {
    const smsBody = title
      ? `MIBBS: Campaign "${title}" saved. We will notify you when it launches.`
      : `MIBBS: Campaign saved. We will notify you when it launches.`;
    const res = await this.sendToUser(userId, smsBody, 'campaign_placeholder');
    // Best-effort WhatsApp
    try {
      await this.sendWhatsappToUser(userId, smsBody, 'campaign_placeholder');
    } catch (err) {
      // ignore whatsapp errors
    }
    // Best-effort email
    try {
      await this.sendEmailToUser(
        userId,
        title ? `Campaign "${title}" Saved — MIBBS` : 'Campaign Saved — MIBBS',
        this.emailWrapper(`
          <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">Campaign Saved 🚀</h2>
          <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
            ${title ? `Your campaign <strong>"${title}"</strong> has been saved.` : 'Your campaign has been saved.'}
            We will notify you when it launches.
          </p>
          <p style="margin:0;color:#6b7280;font-size:14px">— The MIBBS Team</p>
        `),
        smsBody,
        'campaign_placeholder',
      );
    } catch (err) {
      // ignore email errors
    }
    return res;
  }

  async notifyPlanUpdated(userId: string, plan: { monthlyBudget?: number; annualBudget?: number }) {
    const smsBody = plan.monthlyBudget
      ? `MIBBS: Your monthly budget has been updated to ₹${plan.monthlyBudget}.`
      : `MIBBS: Your marketing plan was updated.`;
    const res = await this.sendToUser(userId, smsBody, 'plan_updated');
    // Best-effort WhatsApp
    try {
      await this.sendWhatsappToUser(userId, smsBody, 'plan_updated');
    } catch (err) {
      // ignore whatsapp errors
    }
    // Best-effort email
    try {
      await this.sendEmailToUser(
        userId,
        plan.monthlyBudget
          ? `Your MIBBS Budget Updated — ₹${plan.monthlyBudget.toLocaleString('en-IN')}/mo`
          : 'Your MIBBS Plan Was Updated',
        this.emailWrapper(`
          <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">Budget Updated 🔄</h2>
          <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">Your marketing budget has been revised. All channel allocations have been recalculated.</p>
          ${plan.monthlyBudget ? `
          <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin-bottom:20px">
            <tr>
              <td>
                <span style="color:#6b7280;font-size:13px">New Monthly Budget</span>
                <div style="color:#1f2937;font-size:20px;font-weight:700">₹${plan.monthlyBudget.toLocaleString('en-IN')}</div>
              </td>
            </tr>
          </table>
          ` : ''}
          <p style="margin:0;color:#6b7280;font-size:14px">Log in to your dashboard to review the updated plan.</p>
        `),
        smsBody,
        'plan_updated',
      );
    } catch (err) {
      // ignore email errors
    }
    return res;
  }

  async notifySpendRemoved(userId: string, log: { amount: number; channel: string }) {
    const smsBody = `MIBBS: A spend entry of ₹${log.amount} on ${log.channel} was removed.`;
    const res = await this.sendToUser(userId, smsBody, 'spend_removed');
    // Best-effort WhatsApp
    try {
      await this.sendWhatsappToUser(userId, smsBody, 'spend_removed');
    } catch (err) {
      // ignore whatsapp errors
    }
    // Best-effort email
    try {
      await this.sendEmailToUser(
        userId,
        `Spend Entry Removed — ₹${log.amount.toLocaleString('en-IN')} on ${log.channel}`,
        this.emailWrapper(`
          <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">Spend Entry Removed 🗑️</h2>
          <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">A previously recorded expense has been removed from your account.</p>
          <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin-bottom:20px">
            <tr>
              <td style="border-bottom:1px solid #e5e7eb">
                <span style="color:#6b7280;font-size:13px">Amount Removed</span>
                <div style="color:#1f2937;font-size:20px;font-weight:700">₹${log.amount.toLocaleString('en-IN')}</div>
              </td>
            </tr>
            <tr>
              <td>
                <span style="color:#6b7280;font-size:13px">Channel</span>
                <div style="color:#1f2937;font-size:16px;font-weight:600">${log.channel}</div>
              </td>
            </tr>
          </table>
          <p style="margin:0;color:#6b7280;font-size:14px">Your spend records have been updated. Check your MIBBS dashboard for the latest.</p>
        `),
        smsBody,
        'spend_removed',
      );
    } catch (err) {
      // ignore email errors
    }
    return res;
  }

}
