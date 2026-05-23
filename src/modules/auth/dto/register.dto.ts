import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @ApiProperty({ example: 'Lakshmi Devi' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'lakshmi@example.com' })
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiPropertyOptional({ example: '+919876543210', description: 'E.164 phone number' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phoneE164 must be a valid E.164 phone number' })
  phoneE164?: string;

  @ApiProperty({ example: 'StrongPass!23' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
