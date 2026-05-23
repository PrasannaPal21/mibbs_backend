import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, Max, Min } from 'class-validator';

export class SaveQuestionnaireStepDto {
  @ApiProperty({ minimum: 1, maximum: 8 })
  @IsInt()
  @Min(1)
  @Max(8)
  step!: number;

  @ApiProperty({
    description: 'Partial responses for this step (merged into session.responses)',
    example: { name: 'Lakshmi', businessName: 'Veda Foods', noBusinessName: false },
  })
  @IsObject()
  data!: Record<string, unknown>;
}
