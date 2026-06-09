import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../../providers/email/email.module';
import { SmsModule } from '../../providers/sms/sms.module';
import { WhatsappModule } from '../../providers/whatsapp/whatsapp.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokensService } from './tokens.service';
import { OtpService } from './otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    EmailModule,
    SmsModule,
    WhatsappModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService, OtpService, JwtStrategy],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
