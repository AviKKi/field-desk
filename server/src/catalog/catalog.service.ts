import { Injectable } from '@nestjs/common';
import { CatalogRepository } from '../catalog/catalog.repository.js';

@Injectable()
export class CatalogService {
  constructor(private readonly catalogRepository: CatalogRepository) {}
  list() {
    return this.catalogRepository.list();
  }
}
