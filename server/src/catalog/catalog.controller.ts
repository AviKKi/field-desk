import { Controller, Get } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository.js';
@Controller('crm/catalog')
export class CatalogController {
  constructor(private readonly repository: CatalogRepository) {}
  @Get() list() {
    return this.repository.list();
  }
}
