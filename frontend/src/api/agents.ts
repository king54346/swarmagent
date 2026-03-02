/**
 * Agent API functions
 */

import { get, post, del } from './client';
import type { Agent, AgentMeta } from '../types';

interface AgentListMetaResponse {
  agents: AgentMeta[];
}

interface AgentListFullResponse {
  agents: Agent[];
}

interface AgentCreateResponse {
  agentId: string;
  groupId: string;
  createdAt: string;
}

interface AgentResponse {
  agentId: string;
  role: string;
  llmHistory: string;
}

/**
 * List agents in a workspace (metadata only)
 */
export async function listAgentsMeta(workspaceId: string): Promise<AgentMeta[]> {
  const response = await get<AgentListMetaResponse>('/api/agents', {
    workspaceId,
    meta: true,
  });
  return response.agents;
}

/**
 * List agents in a workspace (full data)
 */
export async function listAgents(workspaceId: string): Promise<Agent[]> {
  const response = await get<AgentListFullResponse>('/api/agents', {
    workspaceId,
  });
  return response.agents;
}

/**
 * Create a new agent
 */
export async function createAgent(params: {
  workspaceId: string;
  creatorId: string;
  role: string;
  groupId?: string;
  guidance?: string;
}): Promise<AgentCreateResponse> {
  return post<AgentCreateResponse>('/api/agents', params);
}

/**
 * Get an agent by ID
 */
export async function getAgent(agentId: string): Promise<AgentResponse> {
  return get<AgentResponse>(`/api/agents/${agentId}`);
}

/**
 * Delete an agent
 */
export async function deleteAgent(agentId: string): Promise<void> {
  await del(`/api/agents/${agentId}`);
}
