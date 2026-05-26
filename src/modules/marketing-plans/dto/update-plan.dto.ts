import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class UpdatePlanDto {
  @ApiProperty({ description: 'New monthly marketing budget in ₹' })
  @IsNumber()
  @Min(1)
  monthlyBudget!: number;
}
