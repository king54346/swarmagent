/**
 * SSE (Server-Sent Events) client utilities
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export interface SSEOptions {
  onMessage?: (event: string, data: unknown) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

/**
 * Create an EventSource connection
 */
export function createEventSource(
  path: string,
  params?: Record<string, string>,
  options: SSEOptions = {}
): EventSource {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const eventSource = new EventSource(url.toString());

  eventSource.onopen = () => {
    options.onOpen?.();
  };

  eventSource.onerror = (error) => {
    options.onError?.(error);
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      options.onMessage?.(data.event || 'message', data.data || data);
    } catch {
      options.onMessage?.('message', event.data);
    }
  };

  return eventSource;
}

/**
 * Create an SSE connection for agent context stream
 */
export function createAgentContextStream(
  agentId: string,
  options: SSEOptions = {}
): EventSource {
  return createEventSource(`/api/agents/${agentId}/context-stream`, undefined, options);
}

/**
 * Create an SSE connection for UI events
 */
export function createUIStream(
  workspaceId: string,
  options: SSEOptions = {}
): EventSource {
  return createEventSource('/api/ui-stream', { workspaceId }, options);
}
