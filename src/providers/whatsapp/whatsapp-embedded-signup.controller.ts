import { Controller, Get, Post, Query, Body, Req, Res, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.schema';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';

@Controller('whatsapp')
export class WhatsAppEmbeddedSignupController {
  private readonly logger = new Logger(WhatsAppEmbeddedSignupController.name);
  private frontendUrl: string;

  constructor(
    private readonly signupService: WhatsAppEmbeddedSignupService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.frontendUrl = this.config.get('CORS_ORIGINS', { infer: true }) || 'http://localhost:3000';
  }

  /**
   * GET /whatsapp/connect
   *
   * Returns the Facebook OAuth URL for the user to complete Embedded Signup.
   * The user will authorize and select their WABA + phone number.
   *
   * The redirect_uri should be set to your backend callback URL:
   *   GET /whatsapp/callback
   */
  @Get('connect')
  getConnectUrl(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      return { error: 'Authentication required' };
    }

    const state = randomBytes(16).toString('hex');
    const redirectUri = `${this.config.get('API_PREFIX', { infer: true }) || 'v1'}/whatsapp/callback`;

    const url = this.signupService.getOAuthUrl(redirectUri, state);

    return {
      url,
      state,
      redirectUri,
      instructions: [
        '1. Open the URL in a new tab/popup',
        '2. Authorize with your Facebook account',
        '3. Select your WhatsApp Business Account',
        '4. Select your phone number',
        '5. You will be redirected back to /whatsapp/callback',
      ],
    };
  }

  /**
   * GET /whatsapp/callback
   *
   * Facebook redirects here after the user completes Embedded Signup.
   * Exchanges the code for tokens and stores the config.
   *
   * Query params: code, state
   */
  @Public()
  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('state') _state: string, @Res() res: Response) {
    if (!code) {
      this.logger.warn('WhatsApp callback: missing authorization code');
      return res.redirect(`${this.frontendUrl}/settings?whatsapp=error&reason=no_code`);
    }

    try {
      const redirectUri = `${this.config.get('API_PREFIX', { infer: true }) || 'v1'}/whatsapp/callback`;

      // Note: In production, the user ID should be passed via state param (JWT-signed)
      // For now, we'll redirect and let the frontend call the save endpoint
      const config = await this.signupService.exchangeCodeForConfig(code, redirectUri);

      this.logger.log(
        `WhatsApp Embedded Signup completed: phoneNumberId=${config.phoneNumberId}, wabaId=${config.wabaId}`,
      );

      // Redirect back to settings with the config params (frontend will call save endpoint)
      const params = new URLSearchParams({
        whatsapp: 'success',
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        phoneNumber: config.phoneNumber,
      });

      return res.redirect(`${this.frontendUrl}/settings?${params.toString()}`);
    } catch (error: unknown) {
      this.logger.error('WhatsApp callback error: ' + (error instanceof Error ? error.message : String(error)));
      return res.redirect(`${this.frontendUrl}/settings?whatsapp=error&reason=exchange_failed`);
    }
  }

  /**
   * POST /whatsapp/save-config
   *
   * Called by the frontend after the OAuth flow completes.
   * The frontend sends the authorization code, and this endpoint
   * exchanges it and stores the config for the authenticated user.
   */
  @Post('save-config')
  @HttpCode(HttpStatus.OK)
  async saveConfig(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: { code: string; redirectUri?: string },
  ) {
    if (!user) {
      return { error: 'Authentication required' };
    }

    if (!body.code) {
      return { error: 'Authorization code is required' };
    }

    try {
      const redirectUri = body.redirectUri || `${this.config.get('API_PREFIX', { infer: true }) || 'v1'}/whatsapp/callback`;

      const config = await this.signupService.exchangeCodeForConfig(body.code, redirectUri);

      await this.signupService.saveConfig(user.id, config);

      return {
        success: true,
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        phoneNumber: config.phoneNumber,
        message: 'WhatsApp connected successfully',
      };
    } catch (error: unknown) {
      this.logger.error('WhatsApp save config error: ' + (error instanceof Error ? error.message : String(error)));
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect WhatsApp',
      };
    }
  }

  /**
   * GET /whatsapp/config
   *
   * Returns the current WhatsApp config for the authenticated user.
   */
  @Get('config')
  async getConfig(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      return { error: 'Authentication required' };
    }

    const config = await this.signupService.getConfig(user.id);
    return {
      connected: !!config,
      config: config ?? null,
    };
  }

  /**
   * POST /whatsapp/disconnect
   *
   * Disconnects WhatsApp for the authenticated user.
   */
  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      return { error: 'Authentication required' };
    }

    await this.signupService.disconnect(user.id);
    return { success: true, message: 'WhatsApp disconnected' };
  }

  /**
   * GET /webhook/whatsapp
   *
   * Webhook verification endpoint. Meta sends a GET request to verify the webhook.
   * Hub mode: subscribe, Hub verify token: your app secret, Hub challenge: random string
   */
  @Public()
  @Get('/webhook')
  handleWebhookVerify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.signupService.verifyWebhook(mode, token, challenge);
    if (result) {
      return res.status(200).send(result);
    }
    return res.status(403).send('Forbidden');
  }

  /**
   * POST /webhook/whatsapp
   *
   * Webhook event handler. Meta sends POST requests for WhatsApp events.
   * This logs the events for now. In production, you'd handle specific event types
   * (message received, delivery status, etc.)
   */
  @Public()
  @Post('/webhook')
  handleWebhookEvent(@Req() req: Request) {
    const body = req.body;

    // Handle the verification challenge
    if (body.object === 'whatsapp_business_account' && body.entry) {
      this.logger.debug(`WhatsApp webhook event received: ${JSON.stringify(body).substring(0, 500)}`);
    }

    // Always return 200 to Meta
    return { status: 'ok' };
  }
}
