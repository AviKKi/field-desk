# Workspace metadata

Exposes role-specific titles and descriptions for the Sales and KAM workspaces.

## Implementation

- [workspace.model.ts](workspace.model.ts): Typed static workspace descriptions.
- [workspace.controller.ts](workspace.controller.ts): Role-protected `/api/workspace/sales` and `/api/workspace/accounts` responses including the signed-in role.
- [workspace.module.ts](workspace.module.ts): Registers the metadata controller.

## Coordination

The descriptions are static application metadata, so this module has no repository, stored entities, or forwarding service. Its route roles do not define access to the separate CRM customer, order, or account reads. Authentication and role enforcement use the global guards and route decorators.

## Related

- [Backend module index](../README.md)
