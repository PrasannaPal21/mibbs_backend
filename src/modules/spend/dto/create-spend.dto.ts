import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSpendDto {
  @ApiProperty({ example: 'Social Media Marketing' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  channel!: string;

  @ApiProperty({ example: 2500 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ description: 'ISO date (defaults to today)' })
  @IsOptional()
  @IsDateString()
  occurredOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Defaults to current marketing plan' })
  @IsOptional()
  @IsString()
  planId?: string;
}
