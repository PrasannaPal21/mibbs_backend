import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DecisionEngineModule } from './modules/decision-engine/decision-engine.module';
import { QuestionnaireModule } from './modules/questionnaire/questionnaire.module';
import { MarketingPlansModule } from './modules/marketing-plans/marketing-plans.module';
import { SpendModule } from './modules/spend/spend.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EmailModule } from './providers/email/email.module';
import { SmsModule } from './providers/sms/sms.module';
import type { Env } from './config/env.schema';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
            remove: true,
          },
          customProps: () => ({ service: 'mibbs-api' }),
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('THROTTLE_TTL', { infer: true }) * 1000,
          limit: config.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
    PrismaModule,
    RedisModule,
    EmailModule,
    SmsModule,
    UsersModule,
    AuthModule,
    DecisionEngineModule,
    QuestionnaireModule,
    MarketingPlansModule,
    SpendModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
