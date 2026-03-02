/**
 * Type definitions for Agent WeChat frontend
 */

export type UUID = string;

// Workspace types
export interface Workspace {
  id: UUID;
  name: string;
  createdAt: string;
}

export interface WorkspaceDefaults {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
}

// Agent types
export interface AgentMeta {
  id: UUID;
  role: string;
  parentId: UUID | null;
  createdAt: string;
}

export interface Agent {
  id: UUID;
  workspaceId: UUID;
  role: string;
  llmHistory: string;
}

// Group types
export interface LastMessage {
  content: string;
  contentType: string;
  sendTime: string;
  senderId: UUID;
}

export interface Group {
  id: UUID;
  name: string | null;
  memberIds: UUID[];
  unreadCount: number;
  contextTokens: number;
  lastMessage?: LastMessage;
  updatedAt: string;
  createdAt: string;
}

// Message types
export interface Message {
  id: UUID;
  senderId: UUID;
  content: string;
  contentType: string;
  sendTime: string;
}

// Graph types
export interface GraphNode {
  id: UUID;
  role: string;
  parentId: UUID | null;
}

export interface GraphEdge {
  from: UUID;
  to: UUID;
  count: number;
  lastSendTime: string;
}

export interface AgentGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    workspaceId: UUID;
    groups: number;
    agents: number;
    messagesConsidered: number;
  };
}

// SSE Event types
export interface SSEEvent<T = unknown> {
  event: string;
  data: T;
}

export interface AgentStreamData {
  kind: 'reasoning' | 'content' | 'tool_calls' | 'tool_result';
  delta: string;
  tool_call_id?: string;
  tool_call_name?: string;
}

export interface UIMessageCreatedData {
  workspaceId: UUID;
  groupId: UUID;
  memberIds?: UUID[];
  message: {
    id: UUID;
    senderId: UUID;
    sendTime: string;
  };
}

export interface UIAgentCreatedData {
  workspaceId: UUID;
  agent: {
    id: UUID;
    role: string;
    parentId: UUID | null;
  };
}

export interface UIGroupCreatedData {
  workspaceId: UUID;
  group: {
    id: UUID;
    name: string | null;
    memberIds: UUID[];
  };
}

// Config types
export interface AppConfig {
  tokenLimit: number;
}
