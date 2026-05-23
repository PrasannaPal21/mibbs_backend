import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';
import type { Env } from '../../config/env.schema';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL', { infer: true });
        const options = {
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          lazyConnect: true,
          retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
        } as const;
        // Upstash / managed Redis services give us a single rediss:// URL
        // that already encodes host, port, password and TLS. Prefer it when
        // present, fall back to discrete host/port/password for local Docker.
        if (url) {
          return new Redis(url, options);
        }
        return new Redis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
          ...options,
        });
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
