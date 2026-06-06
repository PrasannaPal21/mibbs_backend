import { Injectable } from '@nestjs/common';
import { SmsService } from './sms.service';

@Injectable()
export class UserService {
  constructor(private smsService: SmsService) {}

  async updateUser(userId: number, status: string) {
    // example user (replace DB later)
    const user = {
      id: userId,
      phone: '91XXXXXXXXXX',
    };

    await this.smsService.sendSms(
      user.phone,
      `Your status is updated: ${status}`,
    );

    return { message: 'User updated + SMS sent' };
  }
}