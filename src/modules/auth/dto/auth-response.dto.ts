import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ required: false, nullable: true }) phoneE164!: string | null;
  @ApiProperty() locale!: string;
  @ApiProperty() status!: string;
}

export class AuthSuccessDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
  @ApiProperty({ description: 'JWT access token (use as Bearer)' })
  accessToken!: string;
  @ApiProperty({ description: 'Refresh token (also delivered as httpOnly cookie)' })
  refreshToken!: string;
  @ApiProperty() accessExpiresIn!: string;
}
