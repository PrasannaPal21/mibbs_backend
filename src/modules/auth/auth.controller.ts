import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { AuthService, type AuthResult } from './auth.service';
import { TokensService, type IssuedTokens } from './tokens.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OtpSendDto, OtpVerifyDto } from './dto/otp.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';
import { AuthSuccessDto, UserResponseDto } from './dto/auth-response.dto';
import type { Env } from '../../config/env.schema';

const REFRESH_COOKIE = 'mibbs.rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private cookieOptions(maxAgeMs?: number) {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const apiPrefix = this.config.get('API_PREFIX', { infer: true });
    const secureConfig = this.config.get('COOKIE_SECURE', { infer: true });
    const sameSite = this.config.get('COOKIE_SAMESITE', { infer: true });
    const domain = this.config.get('COOKIE_DOMAIN', { infer: true });

    // COOKIE_SECURE=auto → true in production, false in development.
    const secure = secureConfig === 'auto' ? isProd : secureConfig === 'true';

    return {
      httpOnly: true as const,
      secure,
      sameSite,
      // Scope cookie to the auth surface so it never leaks to other routes.
      path: `/${apiPrefix}/auth`,
      maxAge: maxAgeMs,
      // Only set the Domain attribute when explicitly provided; leaving it
      // unset scopes the cookie to the exact host (correct default for
      // cross-site Vercel ↔ Render deployments).
      ...(domain ? { domain } : {}),
    };
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, this.cookieOptions(tokens.refreshExpiresMs));
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private meta(req: Request) {
    return {
      userAgent: req.headers['user-agent'] ?? undefined,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? undefined,
    };
  }

  private toAuthSuccess(result: AuthResult): AuthSuccessDto {
    const u = result.user;
    return {
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        phoneE164: u.phoneE164 ?? null,
        locale: u.locale,
        status: u.status,
      },
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      accessExpiresIn: result.tokens.accessExpiresIn,
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new MIBBS user' })
  @ApiOkResponse({ type: AuthSuccessDto })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSuccessDto> {
    const result = await this.auth.register(dto, this.meta(req));
    this.setRefreshCookie(res, result.tokens);
    return this.toAuthSuccess(result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  @ApiOkResponse({ type: AuthSuccessDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSuccessDto> {
    const result = await this.auth.login(dto, this.meta(req));
    this.setRefreshCookie(res, result.tokens);
    return this.toAuthSuccess(result);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send an OTP (for login, signup verify, phone verify, or password reset)' })
  sendOtp(@Body() dto: OtpSendDto) {
    return this.auth.sendOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an OTP. For LOGIN purpose, returns auth tokens.' })
  async verifyOtp(
    @Body() dto: OtpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.purpose === 'LOGIN') {
      const result = await this.auth.verifyOtpForLogin(dto, this.meta(req));
      this.setRefreshCookie(res, result.tokens);
      return this.toAuthSuccess(result);
    }
    // Generic verify (signup/phone-verify) — let the front-end follow up with the appropriate step
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token + issue a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const token = cookieToken ?? bodyToken;
    if (!token) throw new UnauthorizedException('Refresh token missing');
    const tokens = await this.auth.refresh(token, this.meta(req));
    this.setRefreshCookie(res, tokens);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresIn: tokens.accessExpiresIn,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Revoke the current refresh token + clear cookie. Public so an expired access token does not prevent sign-out.',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(cookieToken);
    this.clearRefreshCookie(res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a password-reset code to the identifier' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using the OTP code' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser() current: AuthenticatedUser): Promise<UserResponseDto> {
    const u = await this.users.getById(current.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phoneE164: u.phoneE164 ?? null,
      locale: u.locale,
      status: u.status,
    };
  }
}
