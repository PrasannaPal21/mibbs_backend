import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const ok = await this.redis.ping();
      const result = this.getStatus(key, ok);
      if (!ok) throw new HealthCheckError('Redis ping failed', result);
      return result;
    } catch (err) {
      throw new HealthCheckError(
        'Redis ping failed',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
