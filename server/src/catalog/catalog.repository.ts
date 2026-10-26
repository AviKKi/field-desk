import { Injectable, Module } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { crmSkus } from '../catalog/catalog.model.js';

@Injectable()
export class CatalogRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  findById(id: string) {
    return this.db.select().from(crmSkus).where(eq(crmSkus.id, id)).get();
  }
  list() {
    return this.db.select().from(crmSkus).orderBy(asc(crmSkus.code)).all();
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [CatalogRepository],
  exports: [CatalogRepository],
})
export class CatalogRepositoryModule {}
