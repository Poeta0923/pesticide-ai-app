import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: '인증 토큰' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
