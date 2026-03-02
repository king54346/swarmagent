/**
 * Message API functions
 */

import { get, post } from './client';
import type { Message } from '../types';

interface MessageListResponse {
  messages: Message[];
}

interface MessageSendResponse {
  id: string;
  sendTime: string;
}

/**
 * List messages in a group
 */
export async function listMessages(
  groupId: string,
  markRead?: boolean,
  readerId?: string
): Promise<Message[]> {
  const response = await get<MessageListResponse>(`/api/groups/${groupId}/messages`, {
    markRead,
    readerId,
  });
  return response.messages;
}

/**
 * Send a message to a group
 */
export async function sendMessage(
  groupId: string,
  senderId: string,
  content: string,
  contentType: string = 'text'
): Promise<MessageSendResponse> {
  return post<MessageSendResponse>(`/api/groups/${groupId}/messages`, {
    senderId,
    content,
    contentType,
  });
}
