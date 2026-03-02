/**
 * Group API functions
 */

import { get, post, del } from './client';
import type { Group } from '../types';

interface GroupListResponse {
  groups: Group[];
}

interface GroupCreateResponse {
  id: string;
  name: string | null;
}

/**
 * List groups
 */
export async function listGroups(params: {
  workspaceId?: string;
  agentId?: string;
}): Promise<Group[]> {
  const response = await get<GroupListResponse>('/api/groups', params);
  return response.groups;
}

/**
 * Create a new group
 */
export async function createGroup(params: {
  workspaceId: string;
  memberIds: string[];
  name?: string;
}): Promise<GroupCreateResponse> {
  return post<GroupCreateResponse>('/api/groups', params);
}

/**
 * Delete a group
 */
export async function deleteGroup(groupId: string): Promise<void> {
  await del(`/api/groups/${groupId}`);
}
