import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const IDENTIFIER_REGEX = /^(\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'lakshmi@example.com' })
  @IsString()
  @Matches(IDENTIFIER_REGEX)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'lakshmi@example.com' })
  @IsString()
  @Matches(IDENTIFIER_REGEX)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ example: 'NewStrongPass!23' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
