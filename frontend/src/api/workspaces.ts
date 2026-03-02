/**
 * Workspace API functions
 */

import { get, post, del } from './client';
import type { Workspace, WorkspaceDefaults } from '../types';

interface WorkspaceListResponse {
  workspaces: Workspace[];
}

/**
 * List all workspaces
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const response = await get<WorkspaceListResponse>('/api/workspaces');
  return response.workspaces;
}

/**
 * Create a new workspace with defaults
 */
export async function createWorkspace(name?: string): Promise<WorkspaceDefaults> {
  return post<WorkspaceDefaults>('/api/workspaces', { name });
}

/**
 * Delete a workspace
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await del(`/api/workspaces/${workspaceId}`);
}

/**
 * Get workspace defaults (human agent, assistant agent, default group)
 */
export async function getWorkspaceDefaults(workspaceId: string): Promise<WorkspaceDefaults> {
  return get<WorkspaceDefaults>(`/api/workspaces/${workspaceId}/defaults`);
}
