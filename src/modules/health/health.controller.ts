import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { PrismaHealthIndicator } from './indicators/prisma.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly prisma: PrismaHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([() => ({ app: { status: 'up' } })]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
