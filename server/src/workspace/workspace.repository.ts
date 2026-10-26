import { Injectable } from '@nestjs/common';
import { workspaceDescriptions } from './workspace.model.js';
import type { WorkspaceArea } from './workspace.model.js';
@Injectable()
export class WorkspaceRepository {
  find(area: WorkspaceArea) {
    return workspaceDescriptions[area];
  }
}
