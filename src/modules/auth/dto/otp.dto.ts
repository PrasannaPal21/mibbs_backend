import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { OtpPurpose } from '@prisma/client';

const IDENTIFIER_REGEX = /^(\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

export class OtpSendDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Email address OR E.164 phone number',
  })
  @IsString()
  @Matches(IDENTIFIER_REGEX, { message: 'identifier must be a valid email or E.164 phone' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier!: string;

  @ApiProperty({ enum: OtpPurpose, example: OtpPurpose.LOGIN })
  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(IDENTIFIER_REGEX, { message: 'identifier must be a valid email or E.164 phone' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ enum: OtpPurpose, example: OtpPurpose.LOGIN })
  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}
