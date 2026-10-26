import { Injectable } from '@nestjs/common';
import type { User, WorkspaceResponse } from '@crm/shared';
import type { WorkspaceArea } from './workspace.model.js';
import { WorkspaceRepository } from './workspace.repository.js';
@Injectable()
export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}
  describe(area: WorkspaceArea, user: User): WorkspaceResponse {
    return { ...this.repository.find(area), role: user.role };
  }
}
