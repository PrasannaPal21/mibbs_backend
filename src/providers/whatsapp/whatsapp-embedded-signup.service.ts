import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../common/prisma/prisma.service';

interface ExchangeTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface WabaInfo {
  id: string;
  name?: string;
  status?: string;
}

interface PhoneInfo {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
}

@Injectable()
export class WhatsAppEmbeddedSignupService {
  private readonly logger = new Logger(WhatsAppEmbeddedSignupService.name);
  private appId: string;
  private appSecret: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.appId = this.config.get('WHATSAPP_META_APP_ID', { infer: true }) || '';
    this.appSecret = this.config.get('WHATSAPP_META_APP_SECRET', { infer: true }) || '';

    if (!this.appId || !this.appSecret) {
      this.logger.warn(
        `WhatsApp Embedded Signup: missing env vars (appId=${this.appId ? '✓' : '✗'} appSecret=${this.appSecret ? '✓' : '✗'}). Embedded Signup will not work.`,
      );
    }
  }

  /**
   * Generate the Facebook OAuth URL for Embedded Signup.
   * The user will be redirected to Facebook to authorize and select their WABA + phone number.
   *
   * @param redirectUri - The URI Facebook redirects to after authorization
   * @param state - CSRF protection token (random string)
   * @returns The full Facebook OAuth URL
   */
  getOAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      state,
      // Embedded Signup specific permissions
      config: 'whatsapp_business_management,messaging',
      response_type: 'code',
      // Scopes needed for Embedded Signup
      scope: [
        'whatsapp_business_management',
        'whatsapp_business_messaging',
        'business_management',
        'pages_show_list',
      ].join(','),
    });

    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for a user access token,
   * then exchange that for a long-lived token, and fetch the WABA + phone number.
   *
   * @param code - The authorization code from the OAuth callback
   * @param redirectUri - Must match the redirect URI used in the OAuth URL
   * @returns The WhatsApp configuration to store
   */
  async exchangeCodeForConfig(code: string, redirectUri: string): Promise<{
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    phoneNumber: string;
    businessId?: string;
  }> {
    // Step 1: Exchange code for short-lived user access token
    const tokenUrl = 'https://graph.facebook.com/v21.0/oauth/access_token';
    const tokenParams = {
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    };

    this.logger.debug('Exchanging OAuth code for access token...');
    const tokenResponse = await axios.get<ExchangeTokenResponse>(tokenUrl, {
      params: tokenParams,
    });
    const shortLivedToken = tokenResponse.data.access_token;
    this.logger.debug('Got short-lived access token');

    // Step 2: Exchange for long-lived token (60 days)
    const longLivedUrl = 'https://graph.facebook.com/v21.0/oauth/access_token';
    const longLivedParams = {
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
    };

    const longLivedResponse = await axios.get<ExchangeTokenResponse>(longLivedUrl, {
      params: longLivedParams,
    });
    const longLivedToken = longLivedResponse.data.access_token;
    this.logger.debug('Got long-lived access token');

    // Step 3: Get the WhatsApp Business Account (WABA) associated with this user
    const wabaUrl = 'https://graph.facebook.com/v21.0/me/waba_accounts';
    const wabaResponse = await axios.get<{ data: WabaInfo[] }>(wabaUrl, {
      params: { access_token: longLivedToken },
    });

    const wabas = wabaResponse.data.data;
    if (!wabas || wabas.length === 0) {
      throw new Error('No WhatsApp Business Account found. Create one at business.facebook.com first.');
    }

    // Use the first WABA (most users have only one)
    const waba = wabas[0];
    const wabaId = waba.id;
    this.logger.debug(`Found WABA: ${wabaId} (${waba.name ?? 'unnamed'})`);

    // Step 4: Get the phone numbers registered to this WABA
    const phoneUrl = `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`;
    const phoneResponse = await axios.get<{ data: PhoneInfo[] }>(phoneUrl, {
      params: { access_token: longLivedToken },
    });

    const phones = phoneResponse.data.data;
    if (!phones || phones.length === 0) {
      throw new Error('No phone numbers found on this WhatsApp Business Account. Register a number first.');
    }

    // Use the first verified phone number
    const phone = phones[0];
    const phoneNumberId = phone.id;
    const phoneNumber = phone.display_phone_number;

    this.logger.debug(
      `Found phone number: ${phoneNumberId} (${phoneNumber}) - verified_name: ${phone.verified_name ?? 'N/A'}`,
    );

    // Step 5: Get the Business ID from the WABA
    let businessId: string | undefined;
    try {
      const businessUrl = `https://graph.facebook.com/v21.0/${wabaId}`;
      const businessResponse = await axios.get<{ id: string }>(businessUrl, {
        params: {
          access_token: longLivedToken,
          fields: 'id,owned_business_info',
        },
      });
      businessId = businessResponse.data.id;
    } catch {
      this.logger.warn('Could not fetch business ID from WABA');
    }

    return {
      accessToken: longLivedToken,
      phoneNumberId,
      wabaId,
      phoneNumber,
      businessId,
    };
  }

  /**
   * Store the WhatsApp config for a user in the database.
   * If a config already exists, it will be updated (reconnect flow).
   */
  async saveConfig(
    userId: string,
    config: {
      accessToken: string;
      phoneNumberId: string;
      wabaId: string;
      phoneNumber: string;
      businessId?: string;
    },
  ): Promise<void> {
    await this.prisma.whatsAppConfig.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        phoneNumber: config.phoneNumber,
        businessId: config.businessId ?? null,
        isVerified: true,
      },
      update: {
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        phoneNumber: config.phoneNumber,
        businessId: config.businessId ?? null,
        isVerified: true,
        connectedAt: new Date(),
      },
    });

    this.logger.log(`WhatsApp config saved for user ${userId}`);
  }

  /**
   * Get the stored WhatsApp config for a user.
   */
  async getConfig(userId: string) {
    return this.prisma.whatsAppConfig.findUnique({
      where: { userId },
      select: {
        id: true,
        phoneNumberId: true,
        wabaId: true,
        phoneNumber: true,
        businessId: true,
        isVerified: true,
        connectedAt: true,
      },
    });
  }

  /**
   * Disconnect WhatsApp for a user (remove stored config).
   */
  async disconnect(userId: string): Promise<void> {
    await this.prisma.whatsAppConfig.deleteMany({
      where: { userId },
    });
    this.logger.log(`WhatsApp disconnected for user ${userId}`);
  }

  /**
   * Handle the WhatsApp webhook verification challenge.
   * Meta sends a GET request with a hub.mode and hub.verify_token.
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verifyToken = this.config.get('WHATSAPP_META_APP_SECRET', { infer: true }) || '';
    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified successfully');
      return challenge;
    }
    this.logger.warn('WhatsApp webhook verification failed');
    return null;
  }
}
