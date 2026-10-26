import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepositoryModule } from '../catalog/catalog.repository.js';
@Module({
  imports: [CatalogRepositoryModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
