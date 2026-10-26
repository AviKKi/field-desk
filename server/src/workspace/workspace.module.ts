import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceRepository } from './workspace.repository.js';
import { WorkspaceService } from './workspace.service.js';
@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceRepository, WorkspaceService],
})
export class WorkspaceModule {}
