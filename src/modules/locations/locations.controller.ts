import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  /**
   * Lookup the locality / city / state for a 6-digit Indian pincode.
   *
   * Public on purpose — the questionnaire calls this before login is even
   * possible on the new-business path (pincode is collected before any
   * sensitive data). Result is cached, so the public surface is cheap.
   */
  @Public()
  @Get('pincode/:pincode')
  @ApiOperation({ summary: 'Reverse-lookup a 6-digit Indian pincode' })
  lookup(@Param('pincode') pincode: string) {
    return this.locations.lookupPincode(pincode);
  }
}
