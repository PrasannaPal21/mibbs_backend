import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async onModuleDestroy() {
    await this.client.quit();
  }

  async ping(): Promise<boolean> {
    if (this.client.status === 'wait') {
      await this.client.connect().catch(() => undefined);
    }
    const pong = await this.client.ping();
    return pong === 'PONG';
  }
}
