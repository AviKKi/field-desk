import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepositoryModule } from '../catalog/catalog.repository.js';
@Module({
  imports: [CatalogRepositoryModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
