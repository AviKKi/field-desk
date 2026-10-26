import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
@Controller('crm/catalog')
export class CatalogController {
  constructor(private readonly service: CatalogService) {}
  @Get() list() {
    return this.service.list();
  }
}
