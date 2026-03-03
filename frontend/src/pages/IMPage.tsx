import {useSearchParams, Link} from "react-router-dom";
import type {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    TouchEvent as ReactTouchEvent
} from "react";
import {Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AnimatePresence, motion} from "framer-motion";
import {ChevronDown, ChevronLeft, ChevronRight, X} from "lucide-react";
import {Streamdown} from "streamdown";
import {createCodePlugin} from "@streamdown/code";
import {mermaid} from "@streamdown/mermaid";
import {IMShell} from "../components/IMShell";
import {IMMessageList} from "../components/IMMessageList";
import {IMHistoryList} from "../components/IMHistoryList";
import {AgentNodeCard} from "../components/AgentNodeCard";
import {AgentEditPanel} from "../components/AgentEditPanel";
import {API_BASE} from "../api/client";

const code = createCodePlugin({themes: ["github-dark", "github-dark"]});

type UUID = string;
type WorkspaceDefaults = { workspaceId: UUID; humanAgentId: UUID; assistantAgentId: UUID; defaultGroupId: UUID };
type AgentMeta = { id: UUID; role: string; parentId: UUID | null; createdAt: string };
type AgentStatus = "IDLE" | "BUSY" | "WAKING";
type Group = {
    id: UUID;
    name: string | null;
    memberIds: UUID[];
    unreadCount: number;
    contextTokens: number;
    maxContextTokens?: number;
    lastMessage?: { content: string; contentType: string; sendTime: string; senderId: UUID };
    updatedAt: string;
    createdAt: string
};
type Message = { id: UUID; senderId: UUID; content: string; contentType: string; sendTime: string };
type UiStreamEvent = { id?: number; at?: number; event: string; data: Record<string, any> };
type VizEvent = { id: string; kind: "agent" | "message" | "llm" | "tool" | "db"; label: string; at: number };
type VizBeam = { id: string; fromId: UUID; toId: UUID; kind: "create" | "message"; label?: string; createdAt: number };
type RightPanelId = "history" | "content" | "reasoning" | "tools";
type RightPanelState = { id: RightPanelId; title: string; size: number; collapsed: boolean };

const streamdownPlugins = {code, mermaid};

const PRESET_AGENT_ROLES = [
    {role: "coder", name: "代码工程师", icon: "👨‍💻", description: "专注于编程、代码审查和技术问题"},
    {role: "productmanager", name: "产品经理", icon: "📋", description: "负责需求分析和产品设计"},
    {role: "designer", name: "设计师", icon: "🎨", description: "UI/UX 设计和视觉创意"},
    {role: "tester", name: "测试工程师", icon: "🧪", description: "质量保证和测试用例设计"},
    {role: "analyst", name: "数据分析师", icon: "📊", description: "数据分析和商业洞察"},
] as const;

const PRESET_ROLES_SET = new Set(PRESET_AGENT_ROLES.map(p => p.role));

function MarkdownContent({content, className = ""}: { content: string; className?: string }) {
    if (!content) return <span className="muted">—</span>;
    return <div className={className}><Streamdown plugins={streamdownPlugins}>{content}</Streamdown></div>;
}

type AgentStreamEvent =
    | {
    id: number;
    at: number;
    event: "agent.stream";
    data: {
        kind: "reasoning" | "content" | "tool_calls" | "tool_result";
        delta: string;
        tool_call_id?: string;
        tool_call_name?: string
    }
}
    | { id: number; at: number; event: "agent.wakeup"; data: { agentId: string; reason?: string | null } }
    | {
    id: number;
    at: number;
    event: "agent.unread";
    data: { agentId: string; batches: Array<{ groupId: string; messageIds: string[] }> }
}
    | { id: number; at: number; event: "agent.done"; data: { finishReason?: string | null } }
    | { id: number; at: number; event: "agent.error"; data: { message: string } };

const SESSION_KEY = "agent-wechat.session.v1";
const RIGHT_PANEL_MIN_HEIGHT = 120;
const RIGHT_PANEL_HEADER_HEIGHT = 32;
const MID_CHAT_MIN_HEIGHT = 0;
const MID_GRAPH_MIN_HEIGHT = 160;
const MID_SPLITTER_SIZE = 6;
const SIDE_SPLITTER_SIZE = 6;
const LEFT_MIN_WIDTH = 220;
const RIGHT_MIN_WIDTH = 260;
const MID_MIN_WIDTH = 360;
const LEFT_COLLAPSED_WIDTH = 44;
const RIGHT_COLLAPSED_WIDTH = 44;

function loadSession(): WorkspaceDefaults | null {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as WorkspaceDefaults;
    } catch {
        return null;
    }
}

function saveSession(session: WorkspaceDefaults) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {...(init?.headers ?? {}), "Content-Type": "application/json"}
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} ${text}`);
    }
    return (await res.json()) as T;
}

function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
}

function cx(...classes: Array<string | false | undefined | null>) {
    return classes.filter(Boolean).join(" ");
}

export default function IMPage() {
    return <Suspense fallback={<div style={{padding: 24}}>Loading...</div>}><IMPageInner/></Suspense>;
}

function IMPageInner() {
    const [searchParams] = useSearchParams();
    const workspaceOverrideId = searchParams.get("workspaceId");
    const [session, setSession] = useState<WorkspaceDefaults | null>(() => null);
    const [tokenLimit, setTokenLimit] = useState<number>(100000);
    const [groups, setGroups] = useState<Group[]>([]);
    const [agents, setAgents] = useState<AgentMeta[]>([]);
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [draft, setDraft] = useState("");
    const [status, setStatus] = useState<"boot" | "groups" | "messages" | "send" | "idle">("boot");
    const [error, setError] = useState<string | null>(null);

    const [contentStream, setContentStream] = useState("");
    const [reasoningStream, setReasoningStream] = useState("");
    const [toolStream, setToolStream] = useState("");
    const [llmHistory, setLlmHistory] = useState("");
    const [showPresetPanel, setShowPresetPanel] = useState(false);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newAgentRole, setNewAgentRole] = useState("");
    const [agentError, setAgentError] = useState<string | null>(null);
    const [vizEvents, setVizEvents] = useState<VizEvent[]>([]);
    const [vizBeams, setVizBeams] = useState<VizBeam[]>([]);
    const [vizSize, setVizSize] = useState({width: 1200, height: 600});
    const [vizScale, setVizScale] = useState(0.9);
    const [vizOffset, setVizOffset] = useState({x: 0, y: 0});
    const [vizIsPanning, setVizIsPanning] = useState(false);
    const [agentStatusById, setAgentStatusById] = useState<Record<string, AgentStatus>>({});
    const [vizEventsCollapsed, setVizEventsCollapsed] = useState(false);
    const [rightPanels, setRightPanels] = useState<RightPanelState[]>([
        {id: "history", title: "LLM history", size: 320, collapsed: false},
        {id: "content", title: "Realtime content", size: 220, collapsed: false},
        {id: "reasoning", title: "Realtime reasoning", size: 220, collapsed: false},
        {id: "tools", title: "Realtime tools", size: 200, collapsed: false},
    ]);
    const [leftWidth, setLeftWidth] = useState(320);
    const [rightWidth, setRightWidth] = useState(420);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [midSplitRatio, setMidSplitRatio] = useState(0.55);
    const [midStackHeight, setMidStackHeight] = useState(0);
    const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
    const [collapsedAgents, setCollapsedAgents] = useState<Record<string, boolean>>({});
    const [expandedVizNodes, setExpandedVizNodes] = useState<Set<string>>(new Set());
    const [editingVizNode, setEditingVizNode] = useState<string | null>(null);
    const [editVizConfig, setEditVizConfig] = useState<{ role: string; guidance: string }>({role: "", guidance: ""});
    const [isEditingPrompt, setIsEditingPrompt] = useState(false);
    const [viewingAgentHistory, setViewingAgentHistory] = useState<string | null>(null);
    const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);

    const bottomRef = useRef<HTMLDivElement | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const activeGroupIdRef = useRef<string | null>(null);
    const streamAgentIdRef = useRef<string | null>(null);
    const streamAgentIdValueRef = useRef<string | null>(null);
    const agentRoleByIdRef = useRef<Map<string, string>>(new Map());
    const toolCallBuffersRef = useRef<Map<string, string>>(new Map());
    const toolResultBuffersRef = useRef<Map<string, string>>(new Map());
    const uiEsRef = useRef<EventSource | null>(null);
    const llmHistoryReqIdRef = useRef(0);
    const vizRef = useRef<HTMLDivElement | null>(null);
    const midStackRef = useRef<HTMLDivElement | null>(null);
    const midChatHeightRef = useRef(0);
    const nodeOffsetsRef = useRef<Record<string, { x: number; y: number }>>({});
    const groupsRef = useRef<Group[]>([]);
    const beamTimeoutsRef = useRef<number[]>([]);
    const refreshQueueRef = useRef<{
        timer: number | null;
        pending: { groups: boolean; agents: boolean; messages: boolean; llmHistory: boolean }
    }>({timer: null, pending: {groups: false, agents: false, messages: false, llmHistory: false}});
    const vizPanStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

    const activeGroup = useMemo(() => groups.find((g) => g.id === activeGroupId) ?? null, [groups, activeGroupId]);
    const agentRoleById = useMemo(() => {
        const map = new Map<string, string>();
        for (const a of agents) map.set(a.id, a.role);
        return map;
    }, [agents]);

    const getGroupLabel = useCallback((g: Group | null | undefined) => {
        if (!g) return "Group";
        if (g.name) return g.name;
        if (g.id === session?.defaultGroupId) return "P2P 人类↔助手";
        const memberRoles = g.memberIds.filter((id) => id !== session?.humanAgentId).map((id) => agentRoleById.get(id) ?? id.slice(0, 8));
        if (memberRoles.length === 1) return `P2P 人类↔${memberRoles[0]}`;
        if (memberRoles.length === 2) return `${memberRoles[0]} ↔ ${memberRoles[1]}`;
        if (memberRoles.length > 2) return `Group (${memberRoles.length})`;
        return "Group";
    }, [agentRoleById, session?.defaultGroupId, session?.humanAgentId]);

    const title = useMemo(() => getGroupLabel(activeGroup), [activeGroup, getGroupLabel]);

    const vizLayout = useMemo(() => {
        const width = Math.max(1, vizSize.width);
        const height = Math.max(1, vizSize.height);
        const paddingX = 180;
        const paddingY = 120;
        const byId = new Map(agents.map((a) => [a.id, a]));
        const parentById = new Map<string, string | null>();
        const childrenById = new Map<string, AgentMeta[]>();
        const roots: AgentMeta[] = [];
        for (const agent of agents) {
            const parentId = agent.parentId;
            if (parentId && parentId !== agent.id && byId.has(parentId)) {
                const list = childrenById.get(parentId) ?? [];
                list.push(agent);
                childrenById.set(parentId, list);
                parentById.set(agent.id, parentId);
            } else {
                roots.push(agent);
                parentById.set(agent.id, null);
            }
        }
        const byCreatedAt = (a: AgentMeta, b: AgentMeta) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        for (const list of childrenById.values()) list.sort(byCreatedAt);
        roots.sort(byCreatedAt);
        if (session) {
            const humanIndex = roots.findIndex((a) => a.id === session.humanAgentId);
            if (humanIndex > -1) {
                const [human] = roots.splice(humanIndex, 1);
                roots.unshift(human);
            }
        }
        const nodeMeta = new Map<string, { xIndex: number; depth: number }>();
        let leafIndex = 0;
        let maxDepth = 0;
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const walk = (agent: AgentMeta, depth: number): { min: number; max: number } => {
            if (visited.has(agent.id)) {
                const meta = nodeMeta.get(agent.id);
                if (meta) return {min: meta.xIndex, max: meta.xIndex};
            }
            if (visiting.has(agent.id)) {
                const xIndex = leafIndex++;
                nodeMeta.set(agent.id, {xIndex, depth});
                return {min: xIndex, max: xIndex};
            }
            visiting.add(agent.id);
            maxDepth = Math.max(maxDepth, depth);
            const children = (childrenById.get(agent.id) ?? []).filter((child) => child.id !== agent.id);
            let range: { min: number; max: number };
            if (children.length === 0) {
                const xIndex = leafIndex++;
                nodeMeta.set(agent.id, {xIndex, depth});
                range = {min: xIndex, max: xIndex};
            } else {
                const ranges = children.map((child) => walk(child, depth + 1));
                const min = ranges[0]?.min ?? leafIndex;
                const max = ranges[ranges.length - 1]?.max ?? min;
                const xIndex = (min + max) / 2;
                nodeMeta.set(agent.id, {xIndex, depth});
                range = {min, max};
            }
            visiting.delete(agent.id);
            visited.add(agent.id);
            return range;
        };
        roots.forEach((root) => walk(root, 0));
        for (const agent of agents) {
            if (!nodeMeta.has(agent.id)) walk(agent, 0);
        }
        const leafCount = Math.max(1, leafIndex);
        const depthCount = Math.max(1, maxDepth + 1);
        const baseSpan = Math.max(1, width - paddingX * 2);
        const minNodeSpacing = 350;
        const maxSpan = Math.max(baseSpan, (leafCount - 1) * minNodeSpacing);
        const xSpan = Math.max(1, maxSpan);
        const xStart = (width - xSpan) / 2;
        const ySpan = Math.max(1, height - paddingY * 2);
        const xStep = leafCount === 1 ? 0 : xSpan / (leafCount - 1);
        const yStep = depthCount === 1 ? 0 : Math.max(ySpan / (depthCount - 1), 250);
        const basePositions = new Map<string, { x: number; y: number }>();
        for (const agent of agents) {
            const meta = nodeMeta.get(agent.id);
            if (!meta) continue;
            basePositions.set(agent.id, {x: xStart + meta.xIndex * xStep, y: paddingY + meta.depth * yStep});
        }
        const offsetCache = new Map<string, { x: number; y: number }>();
        const positions = new Map<string, { x: number; y: number }>();
        const getAccumulatedOffset = (id: string) => {
            if (offsetCache.has(id)) return offsetCache.get(id)!;
            let x = 0, y = 0;
            const seen = new Set<string>();
            let current: string | null | undefined = id;
            while (current) {
                if (seen.has(current)) break;
                seen.add(current);
                const offset = nodeOffsets[current];
                if (offset) {
                    x += offset.x;
                    y += offset.y;
                }
                current = parentById.get(current) ?? null;
            }
            const total = {x, y};
            offsetCache.set(id, total);
            return total;
        };
        for (const agent of agents) {
            const base = basePositions.get(agent.id);
            if (!base) continue;
            const offset = getAccumulatedOffset(agent.id);
            positions.set(agent.id, {x: base.x + offset.x, y: base.y + offset.y});
        }
        const ordered = [...agents].sort((a, b) => {
            const da = nodeMeta.get(a.id)?.depth ?? 0;
            const db = nodeMeta.get(b.id)?.depth ?? 0;
            if (da !== db) return da - db;
            return byCreatedAt(a, b);
        });
        const edges: Array<{ fromId: UUID; toId: UUID }> = [];
        for (const [parentId, children] of childrenById.entries()) {
            for (const child of children) edges.push({fromId: parentId, toId: child.id});
        }
        return {positions, ordered, edges, parentById};
    }, [agents, session, vizSize.height, vizSize.width, nodeOffsets]);

    const groupByAgentId = useMemo(() => {
        const map = new Map<string, Group>();
        if (!session) return map;
        for (const g of groups) {
            if (!g.memberIds.includes(session.humanAgentId)) continue;
            const others = g.memberIds.filter((id) => id !== session.humanAgentId);
            if (others.length === 1) map.set(others[0], g);
        }
        return map;
    }, [groups, session]);

    const agentTreeRows = useMemo(() => {
        if (!session) return [] as Array<{
            agent: AgentMeta;
            group: Group | null;
            depth: number;
            hasChildren: boolean;
            collapsed: boolean;
            guides: boolean[];
            isLast: boolean
        }>;
        const byId = new Map(agents.map((a) => [a.id, a]));
        const childrenById = new Map<string, AgentMeta[]>();
        const roots: AgentMeta[] = [];
        const byCreatedAt = (a: AgentMeta, b: AgentMeta) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        for (const agent of agents) {
            if (agent.role === "human") continue;
            const parentId = agent.parentId;
            const parent = parentId && parentId !== agent.id ? byId.get(parentId) : null;
            if (parent && parent.role !== "human" && parent.id !== agent.id) {
                const list = childrenById.get(parent.id) ?? [];
                list.push(agent);
                childrenById.set(parent.id, list);
            } else roots.push(agent);
        }
        for (const list of childrenById.values()) list.sort(byCreatedAt);
        roots.sort(byCreatedAt);
        const rows: Array<{
            agent: AgentMeta;
            group: Group | null;
            depth: number;
            hasChildren: boolean;
            collapsed: boolean;
            guides: boolean[];
            isLast: boolean
        }> = [];
        const walk = (agent: AgentMeta, depth: number, guides: boolean[], isLast: boolean) => {
            const children = childrenById.get(agent.id) ?? [];
            const collapsed = !!collapsedAgents[agent.id];
            rows.push({
                agent,
                group: groupByAgentId.get(agent.id) ?? null,
                depth,
                hasChildren: children.length > 0,
                collapsed,
                guides,
                isLast
            });
            if (collapsed) return;
            const nextGuides = [...guides, !isLast];
            children.forEach((child, index) => walk(child, depth + 1, nextGuides, index === children.length - 1));
        };
        roots.forEach((root, index) => walk(root, 0, [], index === roots.length - 1));
        return rows;
    }, [agents, collapsedAgents, groupByAgentId, session]);

    const extraGroups = useMemo(() => {
        if (!session) return { p2pGroups: [] as Group[], multiGroups: [] as Group[] };
        const mappedIds = new Set(Array.from(groupByAgentId.values()).map((g) => g.id));
        const unmapped = groups.filter((g) => !mappedIds.has(g.id));
        // P2P: 2人群组，多人群组: >2人
        const p2pGroups = unmapped.filter((g) => g.memberIds.length === 2);
        const multiGroups = unmapped.filter((g) => g.memberIds.length > 2);
        return { p2pGroups, multiGroups };
    }, [groupByAgentId, groups, session]);

    const streamAgentId = useMemo(() => {
        if (!session) return null;
        if (!activeGroupId) return session.assistantAgentId;
        const group = groups.find((g) => g.id === activeGroupId);
        if (!group) return session.assistantAgentId;
        return group.memberIds.find((id) => id !== session.humanAgentId) ?? session.assistantAgentId;
    }, [activeGroupId, groups, session]);

    const refreshAgents = useCallback(async (s: WorkspaceDefaults) => {
        const {agents} = await api<{
            agents: AgentMeta[]
        }>(`/api/agents?workspaceId=${encodeURIComponent(s.workspaceId)}&meta=true`);
        setAgents(agents);
    }, []);
    const formatLlmHistory = useCallback((raw: string) => {
        try {
            return JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
            return raw;
        }
    }, []);

    const refreshLlmHistory = useCallback(async (agentId: string) => {
        const reqId = (llmHistoryReqIdRef.current += 1);
        try {
            const res = await api<{ llmHistory: string }>(`/api/agents/${agentId}`);
            if (reqId !== llmHistoryReqIdRef.current) return;
            setLlmHistory(res.llmHistory ?? "");
        } catch (e) {
            if (reqId !== llmHistoryReqIdRef.current) return;
            setLlmHistory(e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)");
        }
    }, []);

    const llmHistoryParsed = useMemo(() => {
        if (!llmHistory) return null;
        try {
            return JSON.parse(llmHistory);
        } catch {
            return null;
        }
    }, [llmHistory]);
    const llmHistoryFormatted = useMemo(() => {
        if (!llmHistory) return "";
        return formatLlmHistory(llmHistory);
    }, [formatLlmHistory, llmHistory]);

    const bootstrap = useCallback(async (overrideWorkspaceId: string | null) => {
        setError(null);
        setAgentError(null);
        setStatus("boot");
        setGroups([]);
        setMessages([]);
        setLlmHistory("");
        esRef.current?.close();
        if (overrideWorkspaceId) {
            const ensured = await api<WorkspaceDefaults>(`/api/workspaces/${overrideWorkspaceId}/defaults`);
            saveSession(ensured);
            setSession(ensured);
            setActiveGroupId(ensured.defaultGroupId);
            setStatus("idle");
            void refreshAgents(ensured);
            return;
        }
        const existing = loadSession();
        if (existing) {
            try {
                const ensured = await api<WorkspaceDefaults>(`/api/workspaces/${existing.workspaceId}/defaults`);
                saveSession(ensured);
                setSession(ensured);
                setActiveGroupId(ensured.defaultGroupId);
                setStatus("idle");
                void refreshAgents(ensured);
                return;
            } catch { /* fall through */
            }
        }
        try {
            const recent = await api<{
                workspaces: Array<{ id: string; name: string; createdAt: string }>
            }>(`/api/workspaces`);
            if (recent.workspaces.length > 0) {
                const targetId = recent.workspaces[0]!.id;
                const ensured = await api<WorkspaceDefaults>(`/api/workspaces/${targetId}/defaults`);
                saveSession(ensured);
                setSession(ensured);
                setActiveGroupId(ensured.defaultGroupId);
                setStatus("idle");
                void refreshAgents(ensured);
                return;
            }
        } catch { /* fall through */
        }
        const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
            method: "POST",
            body: JSON.stringify({name: "Default Workspace"})
        });
        saveSession(created);
        setSession(created);
        setActiveGroupId(created.defaultGroupId);
        setStatus("idle");
        void refreshAgents(created);
    }, [refreshAgents]);

    const createWorkspace = useCallback(async (name?: string) => {
        setError(null);
        setAgentError(null);
        setStatus("boot");
        const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
            method: "POST",
            body: JSON.stringify({name: name?.trim() || "New Workspace"})
        });
        saveSession(created);
        setSession(created);
        setActiveGroupId(created.defaultGroupId);
        setStatus("idle");
        window.history.replaceState(null, "", "/im");
        void refreshAgents(created);
        return created;
    }, [refreshAgents]);

    useEffect(() => {
        api<{
            tokenLimit: number
        }>("/api/config").then((c) => setTokenLimit(c.tokenLimit)).catch(() => setTokenLimit(100000));
    }, []);

    const refreshGroups = useCallback(async (s: WorkspaceDefaults, opts?: { silent?: boolean }) => {
        if (!opts?.silent) setStatus("groups");
        // 获取所有群组，不仅仅是 human 参与的
        const q = new URLSearchParams({workspaceId: s.workspaceId});
        const {groups} = await api<{ groups: Group[] }>(`/api/groups?${q.toString()}`);
        setGroups(groups);
        if (!opts?.silent) setStatus("idle");
    }, []);

    const refreshMessages = useCallback(async (s: WorkspaceDefaults, groupId: string, opts?: {
        markRead?: boolean;
        silent?: boolean;
        skipGroupRefresh?: boolean
    }) => {
        if (!opts?.silent) setStatus("messages");
        const q = new URLSearchParams();
        if (opts?.markRead ?? true) q.set("markRead", "true");
        q.set("readerId", s.humanAgentId);
        const suffix = q.size ? `?${q.toString()}` : "";
        const {messages} = await api<{ messages: Message[] }>(`/api/groups/${groupId}/messages${suffix}`);
        setMessages(messages);
        if (!opts?.silent) setStatus("idle");
        if (!opts?.skipGroupRefresh) void refreshGroups(s, {silent: opts?.silent});
        queueMicrotask(() => bottomRef.current?.scrollIntoView({behavior: "smooth"}));
    }, [refreshGroups]);

    const pushVizEvent = useCallback((event: UiStreamEvent, label: string, kind: VizEvent["kind"]) => {
        const at = typeof event.at === "number" ? event.at : Date.now();
        const id = `${event.id ?? at}-${Math.random().toString(16).slice(2)}`;
        setVizEvents((prev) => [...prev, {id, kind, label, at}].slice(-20));
    }, []);

    const pushBeam = useCallback((beam: Omit<VizBeam, "id" | "createdAt">) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const createdAt = Date.now();
        setVizBeams((prev) => [...prev, {...beam, id, createdAt}].slice(-12));
        const timeoutId = window.setTimeout(() => setVizBeams((prev) => prev.filter((b) => b.id !== id)), 2400);
        beamTimeoutsRef.current.push(timeoutId);
    }, []);

    const scheduleWorkspaceRefresh = useCallback((opts?: {
        groups?: boolean;
        agents?: boolean;
        messages?: boolean;
        llmHistory?: boolean
    }) => {
        if (!session) return;
        const pending = refreshQueueRef.current.pending;
        pending.groups = opts?.groups ?? true;
        pending.agents = opts?.agents ?? true;
        pending.messages = opts?.messages ?? true;
        pending.llmHistory = opts?.llmHistory ?? true;
        if (refreshQueueRef.current.timer !== null) return;
        refreshQueueRef.current.timer = window.setTimeout(() => {
            const next = refreshQueueRef.current.pending;
            refreshQueueRef.current.pending = {groups: false, agents: false, messages: false, llmHistory: false};
            refreshQueueRef.current.timer = null;
            if (next.groups) void refreshGroups(session, {silent: true});
            if (next.agents) void refreshAgents(session);
            if (next.llmHistory && streamAgentIdValueRef.current) void refreshLlmHistory(streamAgentIdValueRef.current);
            if (next.messages && activeGroupIdRef.current) void refreshMessages(session, activeGroupIdRef.current, {
                markRead: false,
                silent: true,
                skipGroupRefresh: true
            });
        }, 200);
    }, [refreshAgents, refreshGroups, refreshLlmHistory, refreshMessages, session]);

    const connectAgentStream = useCallback((agentId: string) => {
        if (streamAgentIdRef.current === agentId && esRef.current) return;
        streamAgentIdRef.current = agentId;
        esRef.current?.close();
        setLlmHistory("");
        setContentStream("");
        setReasoningStream("");
        setToolStream("");
        setAgentError(null);
        toolCallBuffersRef.current = new Map();
        toolResultBuffersRef.current = new Map();
        const groupId = activeGroupIdRef.current;
        const suffix = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
        const es = new EventSource(`${API_BASE}/api/agents/${agentId}/context-stream${suffix}`);
        esRef.current = es;
        es.onmessage = (evt) => {
            try {
                const payload = JSON.parse(evt.data) as AgentStreamEvent;
                if (payload.event === "agent.stream") {
                    const chunk = payload.data.delta;
                    if (chunk) {
                        if (payload.data.kind === "content") setContentStream((t) => t + chunk);
                        else if (payload.data.kind === "reasoning") setReasoningStream((t) => t + chunk);
                        else {
                            const name = payload.data.tool_call_name ?? payload.data.tool_call_id ?? "tool_call";
                            const key = payload.data.tool_call_id ?? name;
                            const buffers = payload.data.kind === "tool_result" ? toolResultBuffersRef.current : toolCallBuffersRef.current;
                            const next = `${buffers.get(key) ?? ""}${chunk}`;
                            buffers.set(key, next);
                            const callLines = Array.from(toolCallBuffersRef.current.entries()).map(([id, value]) => `tool_calls[${id}]: ${value}`);
                            const resultLines = Array.from(toolResultBuffersRef.current.entries()).map(([id, value]) => `tool_result[${id}]: ${value}`);
                            setToolStream([...callLines, ...resultLines].join("\n\n"));
                        }
                    }
                    return;
                }
                if (payload.event === "agent.wakeup") {
                    setContentStream("");
                    setReasoningStream("");
                    setToolStream("");
                    toolCallBuffersRef.current = new Map();
                    toolResultBuffersRef.current = new Map();
                    return;
                }
                if (payload.event === "agent.unread") {
                    setContentStream("");
                    setReasoningStream("");
                    setToolStream("");
                    toolCallBuffersRef.current = new Map();
                    toolResultBuffersRef.current = new Map();
                    return;
                }
                if (payload.event === "agent.done") {
                    toolCallBuffersRef.current = new Map();
                    toolResultBuffersRef.current = new Map();
                    const groupId = activeGroupIdRef.current;
                    const nextSession = loadSession();
                    if (nextSession && groupId) void refreshMessages(nextSession, groupId, {markRead: false});
                    if (nextSession) void refreshGroups(nextSession);
                    const agentId = streamAgentIdRef.current;
                    if (agentId) void refreshLlmHistory(agentId);
                    return;
                }
                if (payload.event === "agent.error") setAgentError(payload.data.message);
            } catch { /* ignore */
            }
        };
        es.onerror = () => setAgentError("SSE disconnected");
    }, [refreshGroups, refreshMessages, refreshLlmHistory]);

    const deleteAgent = useCallback(async (agentId: string, agentRole: string) => {
        if (!session) return;
        if (agentRole === "human") {
            setError("无法删除人类 Agent");
            return;
        }
        if (!window.confirm(`确定要删除这个 Agent (${agentRole}) 吗？\n\n这将删除该 Agent 的所有消息和群组记录。`)) return;
        setError(null);
        setStatus("boot");
        try {
            if (refreshQueueRef.current.timer !== null) {
                window.clearTimeout(refreshQueueRef.current.timer);
                refreshQueueRef.current.timer = null;
                refreshQueueRef.current.pending = {groups: false, agents: false, messages: false, llmHistory: false};
            }
            await api(`/api/agents/${agentId}`, {method: "DELETE"});
            if (streamAgentIdRef.current === agentId) {
                esRef.current?.close();
                esRef.current = null;
                streamAgentIdRef.current = null;
                setContentStream("");
                setReasoningStream("");
                setToolStream("");
                setLlmHistory("");
            }
            if (activeGroupId && groups.find(g => g.id === activeGroupId)?.memberIds.includes(agentId)) setActiveGroupId(session.defaultGroupId);
            await Promise.all([refreshAgents(session), refreshGroups(session)]);
            setStatus("idle");
        } catch (e) {
            setStatus("idle");
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [activeGroupId, groups, refreshGroups, refreshAgents, session]);

    const createCustomAgent = useCallback(async () => {
        if (!session || !newAgentRole.trim()) return;
        const role = newAgentRole.trim();
        if (PRESET_ROLES_SET.has(role)) {
            setError(`角色 "${role}" 是预设角色，必须通过工具调用创建`);
            return;
        }
        setError(null);
        setStatus("boot");
        setShowCreateDialog(false);
        try {
            await api("/api/agents", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({workspaceId: session.workspaceId, role, parentId: session.assistantAgentId})
            });
            setNewAgentRole("");
            await Promise.all([refreshAgents(session), refreshGroups(session)]);
            setStatus("idle");
        } catch (e) {
            setStatus("idle");
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [session, newAgentRole, refreshAgents, refreshGroups]);

    const onSend = useCallback(async () => {
        if (!session || !activeGroupId) return;
        const text = draft.trim();
        if (!text) return;
        setStatus("send");
        setError(null);
        const optimistic: Message = {
            id: `optimistic-${Date.now()}`,
            senderId: session.humanAgentId,
            content: text,
            contentType: "text",
            sendTime: new Date().toISOString()
        };
        setMessages((m) => [...m, optimistic]);
        setDraft("");
        queueMicrotask(() => bottomRef.current?.scrollIntoView({behavior: "smooth"}));
        try {
            await api(`/api/groups/${activeGroupId}/messages`, {
                method: "POST",
                body: JSON.stringify({senderId: session.humanAgentId, content: text, contentType: "text"})
            });
        } finally { /* keep going */
        }
        setStatus("idle");
        void refreshMessages(session, activeGroupId, {markRead: false});
        void refreshGroups(session);
    }, [activeGroupId, draft, refreshGroups, refreshMessages, session]);

    useEffect(() => {
        void bootstrap(workspaceOverrideId).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, [bootstrap, workspaceOverrideId]);
    useEffect(() => {
        if (session?.assistantAgentId && !streamAgentIdRef.current) connectAgentStream(session.assistantAgentId);
    }, [session, connectAgentStream]);
    useEffect(() => {
        activeGroupIdRef.current = activeGroupId;
    }, [activeGroupId]);
    useEffect(() => {
        streamAgentIdValueRef.current = streamAgentId;
    }, [streamAgentId]);
    useEffect(() => {
        groupsRef.current = groups;
    }, [groups]);
    useEffect(() => {
        agentRoleByIdRef.current = agentRoleById;
    }, [agentRoleById]);
    useEffect(() => {
        nodeOffsetsRef.current = nodeOffsets;
    }, [nodeOffsets]);

    useEffect(() => {
        const el = vizRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.contentRect;
                if (!rect.width || !rect.height) continue;
                setVizSize({width: rect.width, height: rect.height});
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const el = midStackRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.contentRect;
                if (!rect.height) continue;
                setMidStackHeight(rect.height);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const el = vizRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            setVizScale((s) => Math.min(Math.max(s + delta, 0.5), 2));
        };
        el.addEventListener("wheel", onWheel, {passive: false});
        return () => el.removeEventListener("wheel", onWheel);
    }, []);
    useEffect(() => {
        if (!session) return;
        void refreshGroups(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
        void refreshAgents(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, [refreshGroups, refreshAgents, session]);

    useEffect(() => {
        if (!session) return;
        uiEsRef.current?.close();
        const es = new EventSource(`${API_BASE}/api/ui-stream?workspaceId=${encodeURIComponent(session.workspaceId)}`);
        uiEsRef.current = es;
        es.onmessage = (evt) => {
            let payload: UiStreamEvent | null = null;
            try {
                payload = JSON.parse(evt.data) as UiStreamEvent;
            } catch {
                payload = null;
            }
            if (payload) {
                if (payload.event === "ui.agent.created") {
                    const role = payload.data?.agent?.role ?? "agent";
                    const agentId = payload.data?.agent?.id as UUID | undefined;
                    const parentId = payload.data?.agent?.parentId as UUID | null | undefined;
                    pushVizEvent(payload, `创建 ${role}`, "agent");
                    if (agentId) {
                        const fromId = parentId || session.humanAgentId;
                        pushBeam({fromId, toId: agentId, kind: "create", label: role});
                    }
                    if (agentId) setAgentStatusById((prev) => ({...prev, [agentId]: "IDLE"}));
                } else if (payload.event === "ui.message.created") {
                    const senderId = payload.data?.message?.senderId as UUID | undefined;
                    const groupId = payload.data?.groupId as UUID | undefined;
                    const senderRole = senderId ? agentRoleByIdRef.current.get(senderId) ?? senderId.slice(0, 6) : "unknown";
                    pushVizEvent(payload, `消息: ${senderRole}`, "message");
                    if (senderId && groupId) {
                        const payloadMembers = Array.isArray(payload.data?.memberIds) ? payload.data.memberIds : null;
                        const groupMembers = payloadMembers ?? groupsRef.current.find((g) => g.id === groupId)?.memberIds ?? [];
                        const targetIds = groupMembers.filter((id: UUID) => id !== senderId);
                        targetIds.forEach((targetId: string) => pushBeam({
                            fromId: senderId,
                            toId: targetId,
                            kind: "message"
                        }));
                    }
                } else if (payload.event === "ui.agent.llm.start" || payload.event === "ui.agent.llm.done") {
                    const agentId = payload.data?.agentId as UUID | undefined;
                    const role = agentId ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6) : "agent";
                    const label = payload.event === "ui.agent.llm.start" ? `LLM 开始: ${role}` : `LLM 结束: ${role}`;
                    pushVizEvent(payload, label, "llm");
                    if (agentId) setAgentStatusById((prev) => ({
                        ...prev,
                        [agentId]: payload.event === "ui.agent.llm.start" ? "BUSY" : "IDLE"
                    }));
                } else if (payload.event === "ui.agent.tool_call.start" || payload.event === "ui.agent.tool_call.done") {
                    const agentId = payload.data?.agentId as UUID | undefined;
                    const toolName = payload.data?.toolName ?? "tool";
                    const role = agentId ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6) : "agent";
                    const label = payload.event === "ui.agent.tool_call.start" ? `工具开始: ${role} · ${toolName}` : `工具结束: ${role} · ${toolName}`;
                    pushVizEvent(payload, label, "tool");
                    if (agentId) setAgentStatusById((prev) => ({
                        ...prev,
                        [agentId]: payload.event === "ui.agent.tool_call.start" ? "BUSY" : "IDLE"
                    }));
                } else if (payload.event === "ui.db.write") {
                    const table = payload.data?.table ?? "db";
                    const action = payload.data?.action ?? "write";
                    pushVizEvent(payload, `DB ${action}: ${table}`, "db");
                }
            }
            scheduleWorkspaceRefresh();
        };
        es.onerror = () => { /* tolerate disconnects */
        };
        return () => es.close();
    }, [pushBeam, pushVizEvent, scheduleWorkspaceRefresh, session]);

    useEffect(() => {
        if (!streamAgentId) return;
        connectAgentStream(streamAgentId);
        setLlmHistory("");
        void refreshLlmHistory(streamAgentId);
    }, [connectAgentStream, refreshLlmHistory, streamAgentId]);
    useEffect(() => {
        if (!activeGroupId || !session) return;
        void refreshMessages(session, activeGroupId, {markRead: true}).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, [activeGroupId, refreshMessages, session]);
    useEffect(() => {
        if (!session || !activeGroupId) return;
        const currentGroup = groups.find(g => g.id === activeGroupId);
        if (!currentGroup) {
            setActiveGroupId(session.defaultGroupId);
            return;
        }
        const hasNonHumanMember = currentGroup.memberIds.some(id => {
            const agent = agents.find(a => a.id === id);
            return agent && agent.role !== "human";
        });
        if (!hasNonHumanMember) setActiveGroupId(session.defaultGroupId);
    }, [activeGroupId, agents, groups, session]);
    useEffect(() => {
        return () => esRef.current?.close();
    }, []);
    useEffect(() => {
        return () => {
            beamTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
            beamTimeoutsRef.current = [];
        };
    }, []);

    const statusColor = (s?: AgentStatus) => {
        if (s === "BUSY") return "#ef4444";
        if (s === "WAKING") return "#facc15";
        return "#22c55e";
    };

    const midChatHeight = useMemo(() => {
        if (!midStackHeight) return 0;
        const available = Math.max(0, midStackHeight - MID_SPLITTER_SIZE);
        if (available <= 0) return 0;
        const minChat = MID_CHAT_MIN_HEIGHT;
        const minGraph = MID_GRAPH_MIN_HEIGHT;
        if (available <= minGraph + minChat) return Math.max(minChat, available - minGraph);
        const maxChat = available - minGraph;
        const desired = available * midSplitRatio;
        return Math.min(maxChat, Math.max(minChat, desired));
    }, [midSplitRatio, midStackHeight]);

    useEffect(() => {
        midChatHeightRef.current = midChatHeight;
    }, [midChatHeight]);

    const toggleRightPanel = useCallback((id: RightPanelId) => {
        setRightPanels((prev) => prev.map((panel) => panel.id === id ? {
            ...panel,
            collapsed: !panel.collapsed
        } : panel));
    }, []);

    const startMidResize = useCallback((clientY: number) => {
        const container = midStackRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const available = Math.max(0, rect.height - MID_SPLITTER_SIZE);
        if (available <= 0) return;
        const minChat = MID_CHAT_MIN_HEIGHT;
        const minGraph = MID_GRAPH_MIN_HEIGHT;
        const maxChat = Math.max(minChat, available - minGraph);
        const startY = clientY;
        const startHeight = midChatHeightRef.current || available * midSplitRatio;
        const onMove = (e: PointerEvent | MouseEvent) => {
            const delta = e.clientY - startY;
            const next = Math.min(maxChat, Math.max(minChat, startHeight + delta));
            const ratio = available ? next / available : 0.5;
            setMidSplitRatio(ratio);
        };
        const onTouchMove = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            const delta = touch.clientY - startY;
            const next = Math.min(maxChat, Math.max(minChat, startHeight + delta));
            const ratio = available ? next / available : 0.5;
            setMidSplitRatio(ratio);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("touchmove", onTouchMove);
            window.removeEventListener("touchend", onUp);
            document.body.style.cursor = "";
        };
        document.body.style.cursor = "row-resize";
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        window.addEventListener("touchmove", onTouchMove, {passive: false});
        window.addEventListener("touchend", onUp);
    }, [midSplitRatio]);

    const handleMidResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        startMidResize(event.clientY);
    }, [startMidResize]);
    const handleMidMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        startMidResize(event.clientY);
    }, [startMidResize]);
    const handleMidTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        const touch = event.touches[0];
        if (!touch) return;
        startMidResize(touch.clientY);
    }, [startMidResize]);

    const startSideResize = useCallback((side: "left" | "right", clientX: number) => {
        if (side === "left" && leftCollapsed) return;
        if (side === "right" && rightCollapsed) return;
        const containerWidth = document.documentElement.clientWidth;
        const startLeft = leftWidth;
        const startRight = rightWidth;
        const clampLeft = (next: number) => {
            const maxLeft = Math.max(LEFT_MIN_WIDTH, containerWidth - startRight - MID_MIN_WIDTH - SIDE_SPLITTER_SIZE * 2);
            return Math.min(Math.max(next, LEFT_MIN_WIDTH), maxLeft);
        };
        const clampRight = (next: number) => {
            const maxRight = Math.max(RIGHT_MIN_WIDTH, containerWidth - startLeft - MID_MIN_WIDTH - SIDE_SPLITTER_SIZE * 2);
            return Math.min(Math.max(next, RIGHT_MIN_WIDTH), maxRight);
        };
        const onMove = (e: PointerEvent | MouseEvent) => {
            const delta = e.clientX - clientX;
            if (side === "left") setLeftWidth(clampLeft(startLeft + delta)); else setRightWidth(clampRight(startRight - delta));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [leftCollapsed, leftWidth, rightCollapsed, rightWidth]);

    const handleLeftResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        startSideResize("left", event.clientX);
    }, [startSideResize]);
    const handleRightResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        startSideResize("right", event.clientX);
    }, [startSideResize]);

    const handleRightPanelResizeStart = useCallback((panelIndex: number, event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startY = event.clientY;
        const panel = rightPanels[panelIndex];
        const nextPanel = rightPanels[panelIndex + 1];
        if (!panel || !nextPanel || panel.collapsed || nextPanel.collapsed) return;
        const startSize = panel.size;
        const nextStartSize = nextPanel.size;
        const onMove = (e: PointerEvent) => {
            const delta = e.clientY - startY;
            setRightPanels((prev) => prev.map((p, i) => {
                if (i === panelIndex) return {...p, size: Math.max(RIGHT_PANEL_MIN_HEIGHT, startSize + delta)};
                if (i === panelIndex + 1) return {...p, size: Math.max(RIGHT_PANEL_MIN_HEIGHT, nextStartSize - delta)};
                return p;
            }));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [rightPanels]);

    const appGridStyle = useMemo(() => {
        const left = leftCollapsed ? LEFT_COLLAPSED_WIDTH : Math.max(leftWidth, LEFT_MIN_WIDTH);
        const right = rightCollapsed ? RIGHT_COLLAPSED_WIDTH : Math.max(rightWidth, RIGHT_MIN_WIDTH);
        return {gridTemplateColumns: `${left}px ${SIDE_SPLITTER_SIZE}px 1fr ${SIDE_SPLITTER_SIZE}px ${right}px`};
    }, [leftCollapsed, leftWidth, rightCollapsed, rightWidth]);

    const leftPanelHeader = leftCollapsed ? (<div className="header" style={{justifyContent: "center"}}>
        <button type="button" className="btn" style={{padding: "4px 6px", fontSize: 12}}
                onClick={() => setLeftCollapsed(false)} title="展开"><ChevronRight size={14}/></button>
    </div>) : null;
    const rightPanelHeader = rightCollapsed ? (<div className="header" style={{justifyContent: "center"}}>
        <button type="button" className="btn" style={{padding: "4px 6px", fontSize: 12}}
                onClick={() => setRightCollapsed(false)} title="展开"><ChevronLeft size={14}/></button>
    </div>) : null;

    const renderGroupRow = useCallback((group: Group, opts?: {
        depth?: number;
        hasChildren?: boolean;
        collapsed?: boolean;
        agentId?: string;
        guides?: boolean[];
        isLast?: boolean
    }) => {
        const depth = opts?.depth ?? 0;
        const hasChildren = opts?.hasChildren ?? false;
        const collapsed = opts?.collapsed ?? false;
        const agentId = opts?.agentId;
        const guides = opts?.guides ?? [];
        const isLast = opts?.isLast ?? true;
        const isActive = group.id === activeGroupId;
        const label = getGroupLabel(group);
        const unread = group.unreadCount > 0 ? `(${group.unreadCount})` : "";
        const isDefaultGroup = group.id === session?.defaultGroupId;
        return (
            <div key={group.id} style={{
                position: "relative",
                paddingLeft: depth > 0 ? 12 + depth * 20 : 12,
                paddingRight: isDefaultGroup ? 12 : 40,
                paddingTop: 10,
                paddingBottom: 10,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: isActive ? "rgba(59, 130, 246, 0.15)" : "transparent",
                borderLeft: isActive ? "3px solid rgba(59, 130, 246, 0.8)" : "3px solid transparent",
                transition: "all 0.2s ease",
                borderBottom: "1px solid rgba(100, 150, 255, 0.1)"
            }} onClick={() => setActiveGroupId(group.id)} onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "rgba(59, 130, 246, 0.05)";
                if (!isDefaultGroup) setHoveredGroupId(group.id);
            }} onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
                setHoveredGroupId(null);
            }}>
                {guides.length > 0 && (<div style={{
                    display: "flex",
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    pointerEvents: "none"
                }}>{guides.map((hasLine, i) => (<div key={i} style={{
                    width: 20,
                    marginLeft: 12,
                    borderLeft: hasLine ? "1px solid rgba(100, 150, 255, 0.2)" : "none"
                }}/>))}</div>)}
                {hasChildren && agentId ? (<div onClick={(e) => {
                    e.stopPropagation();
                    setCollapsedAgents((prev) => ({...prev, [agentId]: !prev[agentId]}));
                }} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: "rgba(59, 130, 246, 0.2)",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
                    cursor: "pointer",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#60a5fa",
                    userSelect: "none",
                    transition: "all 0.2s ease"
                }}>{collapsed ? "▸" : "▾"}</div>) : (<div style={{width: 16}}/>)}
                <div style={{flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0}}>
                    <div style={{display: "flex", alignItems: "center", gap: 6}}>
                        <div style={{
                            flex: 1,
                            fontSize: 13,
                            fontWeight: isActive ? 600 : 500,
                            color: isActive ? "#e0f2fe" : "#e2e8f0",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                        }}>{label}</div>
                        {unread && (<div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#fbbf24",
                            background: "rgba(251, 191, 36, 0.2)",
                            padding: "2px 6px",
                            borderRadius: 10,
                            border: "1px solid rgba(251, 191, 36, 0.3)"
                        }}>{group.unreadCount}</div>)}
                    </div>
                    <div style={{display: "flex", alignItems: "center", gap: 8}}>
                        <div style={{flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0}}>
                            {group.contextTokens > 0 ? (
                                <>
                                    <span style={{fontSize: 10, opacity: 0.6}}>📊</span>
                                    <div style={{
                                        flex: 1,
                                        height: 6,
                                        background: "rgba(15, 23, 42, 0.6)",
                                        borderRadius: 3,
                                        overflow: "hidden",
                                        border: "1px solid rgba(100, 150, 255, 0.12)",
                                        position: "relative"
                                    }}>
                                        <div style={{
                                            width: `${Math.min(100, (group.contextTokens / (group.maxContextTokens || 128000)) * 100)}%`,
                                            height: "100%",
                                            background: group.contextTokens / (group.maxContextTokens || 128000) > 0.9 ? "linear-gradient(90deg, #f87171 0%, #ef4444 50%, #dc2626 100%)" : group.contextTokens / (group.maxContextTokens || 128000) > 0.7 ? "linear-gradient(90deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)" : "linear-gradient(90deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)",
                                            borderRadius: 2,
                                            transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                                        }}/>
                                    </div>
                                    <div className="mono" style={{
                                        fontSize: 9,
                                        fontWeight: 600,
                                        color: group.contextTokens / (group.maxContextTokens || 128000) > 0.9 ? "#fca5a5" : group.contextTokens / (group.maxContextTokens || 128000) > 0.7 ? "#fcd34d" : "#93c5fd",
                                        minWidth: 28,
                                        textAlign: "right",
                                        opacity: 0.9
                                    }}>{Math.round((group.contextTokens / (group.maxContextTokens || 128000)) * 100)}%
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span style={{fontSize: 10, opacity: 0.6}}>👥</span>
                                    <span className="muted mono" style={{fontSize: 9}}>
                                        {group.memberIds.length} 成员
                                    </span>
                                </>
                            )}
                        </div>
                        {group.lastMessage && (<div className="muted mono" style={{
                            fontSize: 9,
                            opacity: 0.5,
                            flexShrink: 0
                        }}>{fmtTime(group.lastMessage.sendTime)}</div>)}
                    </div>
                </div>
            </div>
        );
    }, [activeGroupId, getGroupLabel, fmtTime, session, hoveredGroupId, collapsedAgents]);

    const historyRole = useCallback((entry: any) => {
        const role = entry?.role || "unknown";
        if (role === "system") return "🧠";
        if (role === "user") return "👤";
        if (role === "assistant") return "🤖";
        if (role === "tool") return "🛠️";
        return "❓";
    }, []);

    const historyAccent = useCallback((roleIcon: string) => {
        if (roleIcon === "🧠") return "#fbbf24";
        if (roleIcon === "👤") return "#60a5fa";
        if (roleIcon === "🤖") return "#34d399";
        if (roleIcon === "🛠️") return "#fb7185";
        return "#94a3b8";
    }, []);

    const summarizeHistoryEntry = useCallback((entry: any) => {
        if (!entry) return "";
        const role = entry.role || "unknown";
        const content = entry.content || "";
        if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
            const toolNames = entry.tool_calls.map((tc: any) => tc?.function?.name || "unknown").join(", ");
            return `Tool calls: ${toolNames}`;
        }
        if (role === "tool") {
            const toolName = entry.name || "unknown";
            const preview = typeof content === "string" ? content.slice(0, 50) : JSON.stringify(content).slice(0, 50);
            return `${toolName}: ${preview}...`;
        }
        if (typeof content === "string") return content.slice(0, 100);
        return JSON.stringify(content).slice(0, 100);
    }, []);

    const handleNodePointerDown = useCallback((nodeId: string, event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startOffset = nodeOffsets[nodeId] ?? {x: 0, y: 0};
        const onMove = (e: PointerEvent) => {
            const dx = (e.clientX - startX) / vizScale;
            const dy = (e.clientY - startY) / vizScale;
            setNodeOffsets((prev) => ({...prev, [nodeId]: {x: startOffset.x + dx, y: startOffset.y + dy}}));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [nodeOffsets, vizScale]);

    const handleNodeMouseDown = useCallback((nodeId: string, event: ReactMouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startOffset = nodeOffsets[nodeId] ?? {x: 0, y: 0};
        const onMove = (e: MouseEvent) => {
            const dx = (e.clientX - startX) / vizScale;
            const dy = (e.clientY - startY) / vizScale;
            setNodeOffsets((prev) => ({...prev, [nodeId]: {x: startOffset.x + dx, y: startOffset.y + dy}}));
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [nodeOffsets, vizScale]);

    const handleNodeTouchStart = useCallback((nodeId: string, event: ReactTouchEvent<HTMLDivElement>) => {
        event.stopPropagation();
        const touch = event.touches[0];
        if (!touch) return;
        const startX = touch.clientX;
        const startY = touch.clientY;
        const startOffset = nodeOffsets[nodeId] ?? {x: 0, y: 0};
        const onMove = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            const dx = (touch.clientX - startX) / vizScale;
            const dy = (touch.clientY - startY) / vizScale;
            setNodeOffsets((prev) => ({...prev, [nodeId]: {x: startOffset.x + dx, y: startOffset.y + dy}}));
        };
        const onUp = () => {
            window.removeEventListener("touchmove", onMove);
            window.removeEventListener("touchend", onUp);
        };
        window.addEventListener("touchmove", onMove);
        window.addEventListener("touchend", onUp);
    }, [nodeOffsets, vizScale]);

    return (
        <IMShell className="im-shell" style={appGridStyle}
                 leftResizer={<div className={cx("panel-resizer", leftCollapsed && "disabled")}
                                   onPointerDown={handleLeftResizeStart}/>}
                 rightResizer={<div className={cx("panel-resizer", rightCollapsed && "disabled")}
                                    onPointerDown={handleRightResizeStart}/>}
                 left={
                     <aside className="panel panel-left">
                         {leftCollapsed ? leftPanelHeader : (
                             <>
                                 <div className="header">
                                     <div>
                                         <div style={{fontWeight: 700}}>Workspace</div>
                                         <div className="muted mono"
                                              style={{fontSize: 12}}>{session?.workspaceId ?? "-"}</div>
                                     </div>
                                     <div style={{display: "flex", gap: 8}}>
                                         <button type="button" className="btn"
                                                 style={{padding: "4px 8px", fontSize: 11}}
                                                 onClick={() => setShowPresetPanel(!showPresetPanel)}
                                                 title="查看预设 Agent 类型">📊 预设
                                         </button>
                                         <button type="button" className="btn"
                                                 style={{padding: "4px 8px", fontSize: 11}}
                                                 onClick={() => setShowCreateDialog(true)} title="创建自定义 Agent">+
                                             Agent
                                         </button>
                                         <button type="button" className="btn"
                                                 style={{padding: "4px 8px", fontSize: 11}}
                                                 onClick={() => setLeftCollapsed(true)} title="收起"><ChevronLeft
                                             size={14}/></button>
                                     </div>
                                 </div>
                                 <div style={{padding: 12, borderBottom: "1px solid rgba(100, 150, 255, 0.1)"}}>
                                     <div className="muted mono" style={{fontSize: 11, lineHeight: 1.4}}>
                                         <div style={{
                                             display: "flex",
                                             justifyContent: "space-between",
                                             marginBottom: 4
                                         }}><span>Human:</span><span
                                             style={{opacity: 0.6}}>{session?.humanAgentId.slice(0, 8) ?? "-"}</span>
                                         </div>
                                         <div style={{display: "flex", justifyContent: "space-between"}}>
                                             <span>Assistant:</span><span
                                             style={{opacity: 0.6}}>{session?.assistantAgentId.slice(0, 8) ?? "-"}</span>
                                         </div>
                                     </div>
                                 </div>
                                 <div className="list">
                                     {agentTreeRows.length === 0 && extraGroups.p2pGroups.length === 0 && extraGroups.multiGroups.length === 0 ? (
                                         <div style={{padding: 16}} className="muted">No groups yet.</div>) : (
                                         <>
                                             {/* P2P 私聊区域 */}
                                             <div style={{
                                                 padding: "8px 12px",
                                                 fontSize: 11,
                                                 fontWeight: 600,
                                                 color: "#94a3b8",
                                                 borderBottom: "1px solid rgba(100, 150, 255, 0.1)",
                                                 background: "rgba(59, 130, 246, 0.05)",
                                                 display: "flex",
                                                 alignItems: "center",
                                                 gap: 6
                                             }}>
                                                 <span>👤</span> P2P 私聊
                                             </div>
                                             {agentTreeRows.map(({
                                                                    agent,
                                                                    group,
                                                                    depth,
                                                                    hasChildren,
                                                                    collapsed,
                                                                    guides,
                                                                    isLast
                                                                }) => group ? renderGroupRow(group, {
                                                 depth,
                                                 hasChildren,
                                                 collapsed,
                                                 agentId: agent.id,
                                                 guides,
                                                 isLast
                                             }) : null)}
                                             {extraGroups.p2pGroups.map((g) => renderGroupRow(g))}
                                                                             
                                             {/* 多人群组区域 */}
                                             {extraGroups.multiGroups.length > 0 && (
                                                 <>
                                                     <div style={{
                                                         padding: "8px 12px",
                                                         fontSize: 11,
                                                         fontWeight: 600,
                                                         color: "#94a3b8",
                                                         borderBottom: "1px solid rgba(100, 150, 255, 0.1)",
                                                         borderTop: "1px solid rgba(100, 150, 255, 0.1)",
                                                         background: "rgba(168, 85, 247, 0.05)",
                                                         marginTop: 8,
                                                         display: "flex",
                                                         alignItems: "center",
                                                         gap: 6
                                                     }}>
                                                         <span>👥</span> 多人群组 ({extraGroups.multiGroups.length})
                                                     </div>
                                                     {extraGroups.multiGroups.map((g) => renderGroupRow(g))}
                                                 </>
                                             )}
                                         </>
                                     )}
                                 </div>
                             </>
                         )}
                     </aside>
                 }
                 mid={
                     <main className="panel panel-mid">
                         <div className="header">
                             <div style={{fontWeight: 700}}>{title}</div>
                             <div className="muted"
                                  style={{fontSize: 12}}>{status !== "idle" ? `${status}...` : ""}</div>
                         </div>
                         <div className="mid-stack" ref={midStackRef}
                              style={{gridTemplateRows: midStackHeight > 0 ? `${Math.max(0, Math.round(midChatHeight))}px ${MID_SPLITTER_SIZE}px minmax(${MID_GRAPH_MIN_HEIGHT}px, 1fr)` : `1fr ${MID_SPLITTER_SIZE}px minmax(${MID_GRAPH_MIN_HEIGHT}px, 1fr)`}}>
                             <div className="chat">
                                 <IMMessageList messages={messages} humanAgentId={session?.humanAgentId ?? null}
                                                agentRoleById={agentRoleById} fmtTime={fmtTime}
                                                renderContent={(content) => <MarkdownContent content={content}/>}
                                                cx={cx}/>
                                 <div ref={bottomRef}/>
                             </div>
                             <div className="mid-resizer" onPointerDown={handleMidResizeStart}
                                  onMouseDown={handleMidMouseDown} onTouchStart={handleMidTouchStart}/>
                             <div className="viz-shell">
                                 <div ref={vizRef} className="viz-canvas" style={{
                                     position: "relative",
                                     minHeight: 200,
                                     borderTop: "1px solid rgba(100, 150, 255, 0.2)",
                                     background: "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.2), transparent 45%), radial-gradient(circle at 80% 70%, rgba(147,51,234,0.15), transparent 50%), radial-gradient(circle at 50% 50%, rgba(34,197,94,0.08), transparent 60%), linear-gradient(transparent 23px, rgba(100,150,255,0.15) 24px), linear-gradient(90deg, transparent 23px, rgba(100,150,255,0.15) 24px), linear-gradient(135deg, #0a0e27 0%, #1a1a2e 100%)",
                                     backgroundSize: "100% 100%, 100% 100%, 100% 100%, 24px 24px, 24px 24px, auto",
                                     cursor: vizIsPanning ? "grabbing" : "grab",
                                     overflow: "hidden"
                                 }}
                                      onMouseDown={(e) => {
                                          if (e.button !== 0) return;
                                          setVizIsPanning(true);
                                          vizPanStartRef.current = {
                                              x: e.clientX,
                                              y: e.clientY,
                                              ox: vizOffset.x,
                                              oy: vizOffset.y
                                          };
                                      }}
                                      onMouseMove={(e) => {
                                          if (!vizIsPanning || !vizPanStartRef.current) return;
                                          const dx = e.clientX - vizPanStartRef.current.x;
                                          const dy = e.clientY - vizPanStartRef.current.y;
                                          setVizOffset({
                                              x: vizPanStartRef.current.ox + dx,
                                              y: vizPanStartRef.current.oy + dy
                                          });
                                      }}
                                      onMouseUp={() => {
                                          setVizIsPanning(false);
                                          vizPanStartRef.current = null;
                                      }}
                                      onMouseLeave={() => {
                                          setVizIsPanning(false);
                                          vizPanStartRef.current = null;
                                      }}>
                                     <div style={{
                                         position: "absolute",
                                         left: 12,
                                         top: 12,
                                         display: "flex",
                                         gap: 8,
                                         alignItems: "center",
                                         padding: "6px 10px",
                                         borderRadius: 999,
                                         border: "1px solid rgba(100, 150, 255, 0.3)",
                                         background: "rgba(10, 14, 39, 0.8)",
                                         backdropFilter: "blur(10px)",
                                         fontSize: 12,
                                         color: "#e4e4e7"
                                     }}>
                                         <span className="mono">缩放 {Math.round(vizScale * 100)}%</span>
                                         <button className="btn" style={{padding: "2px 8px", fontSize: 12}}
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     setVizScale((s) => Math.min(s + 0.1, 2));
                                                 }}>+
                                         </button>
                                         <button className="btn" style={{padding: "2px 8px", fontSize: 12}}
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     setVizScale((s) => Math.max(s - 0.1, 0.5));
                                                 }}>-
                                         </button>
                                         <button className="btn" style={{padding: "2px 8px", fontSize: 12}}
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     setVizScale(0.9);
                                                     setVizOffset({x: 0, y: 0});
                                                 }}>Reset
                                         </button>
                                         <span className="muted mono">Ctrl/⌘ + 滚轮缩放</span>
                                     </div>
                                     <div style={{
                                         position: "absolute",
                                         inset: 0,
                                         transform: `translate(${vizOffset.x}px, ${vizOffset.y}px) scale(${vizScale})`,
                                         transformOrigin: "center center",
                                         transition: vizIsPanning ? "none" : "transform 120ms ease-out"
                                     }}>
                                         <svg width={vizSize.width} height={vizSize.height}
                                              style={{position: "absolute", inset: 0, overflow: "visible"}}>
                                             <defs>
                                                 <linearGradient id="edgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                     <stop offset="0%" stopColor="rgba(59,130,246,0.4)"/>
                                                     <stop offset="50%" stopColor="rgba(147,51,234,0.3)"/>
                                                     <stop offset="100%" stopColor="rgba(168,85,247,0.4)"/>
                                                 </linearGradient>
                                                 <filter id="connectionGlow">
                                                     <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                                                     <feMerge>
                                                         <feMergeNode in="coloredBlur"/>
                                                         <feMergeNode in="SourceGraphic"/>
                                                     </feMerge>
                                                 </filter>
                                             </defs>
                                             <g>{vizLayout.edges.map((edge) => {
                                                 const from = vizLayout.positions.get(edge.fromId);
                                                 const to = vizLayout.positions.get(edge.toId);
                                                 if (!from || !to) return null;
                                                 const dx = to.x - from.x;
                                                 const dy = to.y - from.y;
                                                 const distance = Math.sqrt(dx * dx + dy * dy);
                                                 const curvature = Math.min(distance * 0.4, 120);
                                                 const path = `M ${from.x} ${from.y} C ${from.x} ${from.y + curvature}, ${to.x} ${to.y - curvature}, ${to.x} ${to.y}`;
                                                 return (<g key={`${edge.fromId}-${edge.toId}`}>
                                                     <path d={path} stroke="url(#edgeGradient)" strokeWidth={2}
                                                           fill="none" strokeLinecap="round"
                                                           filter="url(#connectionGlow)" opacity={0.5}/>
                                                     <circle cx={from.x} cy={from.y + 50} r={3}
                                                             fill="rgba(59, 130, 246, 0.8)"
                                                             filter="url(#connectionGlow)"/>
                                                     <circle cx={to.x} cy={to.y - 50} r={3}
                                                             fill="rgba(168, 85, 247, 0.8)"
                                                             filter="url(#connectionGlow)"/>
                                                 </g>);
                                             })}</g>
                                             <AnimatePresence>{vizBeams.map((beam) => {
                                                 const from = vizLayout.positions.get(beam.fromId);
                                                 const to = vizLayout.positions.get(beam.toId);
                                                 if (!from || !to) return null;
                                                 const color = beam.kind === "create" ? "#3b82f6" : "#ffffff";
                                                 return (<motion.g key={beam.id} initial={{opacity: 0}}
                                                                   animate={{opacity: 0.9}} exit={{opacity: 0}}
                                                                   transition={{duration: 0.6}}>
                                                     <motion.line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                                                                  stroke={color}
                                                                  strokeWidth={beam.kind === "create" ? 2.5 : 1.6}
                                                                  strokeDasharray={beam.kind === "create" ? "8 6" : "0"}
                                                                  initial={{pathLength: 0, opacity: 0}} animate={{
                                                         pathLength: 1,
                                                         opacity: beam.kind === "create" ? 0.5 : 0.35
                                                     }} transition={{duration: 0.5}}/>
                                                     <motion.circle r={beam.kind === "create" ? 7 : 4} fill={color}
                                                                    initial={{cx: from.x, cy: from.y}}
                                                                    animate={{cx: to.x, cy: to.y}}
                                                                    transition={{duration: 0.8, ease: "easeInOut"}}
                                                                    style={{filter: `drop-shadow(0 0 ${beam.kind === "create" ? "12px" : "5px"} ${color})`}}/>
                                                     {beam.label ? (<foreignObject x={(from.x + to.x) / 2 - 80}
                                                                                   y={(from.y + to.y) / 2 - 40}
                                                                                   width={160} height={40}>
                                                         <div style={{
                                                             fontSize: 11,
                                                             fontWeight: 700,
                                                             color: beam.kind === "create" ? "#bfdbfe" : "#e4e4e7",
                                                             border: `1px solid ${beam.kind === "create" ? "rgba(59,130,246,0.5)" : "rgba(82,82,91,0.5)"}`,
                                                             background: beam.kind === "create" ? "rgba(30,58,138,0.6)" : "rgba(9,9,11,0.7)",
                                                             borderRadius: 999,
                                                             padding: "4px 8px",
                                                             textAlign: "center"
                                                         }}>{beam.kind === "create" ? `create_agent(${beam.label})` : "send_message"}</div>
                                                     </foreignObject>) : null}</motion.g>);
                                             })}</AnimatePresence>
                                         </svg>
                                         {vizLayout.ordered.map((agent) => {
                                             const pos = vizLayout.positions.get(agent.id);
                                             if (!pos) return null;
                                             const status = agentStatusById[agent.id] ?? "IDLE";
                                             const isActive = streamAgentId === agent.id;
                                             const isExpanded = expandedVizNodes.has(agent.id);
                                             return (<AgentNodeCard key={agent.id} agent={agent} position={pos}
                                                                    status={status} isActive={isActive}
                                                                    isExpanded={isExpanded} onDoubleClick={() => {
                                                 setExpandedVizNodes(prev => {
                                                     const next = new Set(prev);
                                                     if (next.has(agent.id)) next.delete(agent.id); else next.add(agent.id);
                                                     return next;
                                                 });
                                             }} onEditPrompt={() => {
                                                 setEditingVizNode(agent.id);
                                                 const agentMeta = agents.find(a => a.id === agent.id);
                                                 if (agentMeta) setEditVizConfig({role: agentMeta.role, guidance: ""});
                                             }} onViewHistory={() => setViewingAgentHistory(agent.id)} onDelete={() => {
                                                 api(`/api/agents/${agent.id}`, {method: "DELETE"}).then(() => refreshAgents(session!)).catch((err) => alert(`删除失败: ${err.message}`));
                                             }} onPointerDown={(e) => handleNodePointerDown(agent.id, e)}
                                                                    onMouseDown={(e) => handleNodeMouseDown(agent.id, e)}
                                                                    onTouchStart={(e) => handleNodeTouchStart(agent.id, e)}/>);
                                         })}
                                     </div>
                                 </div>
                                 {editingVizNode && (() => {
                                     const selectedAgent = agents.find(a => a.id === editingVizNode);
                                     if (!selectedAgent) return null;
                                     const parentRoleLabel = selectedAgent.parentId ? agents.find(a => a.id === selectedAgent.parentId)?.role ?? "Unknown" : null;
                                     return (<AgentEditPanel agent={selectedAgent} parentRoleLabel={parentRoleLabel}
                                                             isEditingPrompt={isEditingPrompt}
                                                             guidance={editVizConfig.guidance}
                                                             vizEventsCollapsed={vizEventsCollapsed}/>);
                                 })()}
                                 <div className={cx("viz-events", vizEventsCollapsed && "collapsed")}>
                                     {!vizEventsCollapsed ? (<>
                                         <div style={{
                                             fontWeight: 700,
                                             marginBottom: 8,
                                             display: "flex",
                                             justifyContent: "space-between",
                                             alignItems: "center"
                                         }}><span>事件流</span>
                                             <div style={{display: "flex", alignItems: "center", gap: 8}}><span
                                                 className="muted mono">{vizEvents.length}</span>
                                                 <button type="button" className="viz-events-toggle"
                                                         onClick={() => setVizEventsCollapsed(true)} title="收起">
                                                     <ChevronRight size={16}/></button>
                                             </div>
                                         </div>
                                         {vizEvents.length === 0 ? (<div
                                             className="muted">暂无事件</div>) : (vizEvents.slice(-6).reverse().map((evt) => (
                                             <div key={evt.id} style={{
                                                 marginBottom: 8,
                                                 paddingBottom: 8,
                                                 borderBottom: "1px solid rgba(39,39,42,0.6)"
                                             }}>
                                                 <div style={{
                                                     fontWeight: 600,
                                                     display: "flex",
                                                     alignItems: "center",
                                                     gap: 6
                                                 }}><span style={{
                                                     width: 8,
                                                     height: 8,
                                                     borderRadius: 999,
                                                     background: evt.kind === "agent" ? "#60a5fa" : evt.kind === "message" ? "#fbbf24" : evt.kind === "llm" ? "#38bdf8" : evt.kind === "tool" ? "#f97316" : "#a855f7"
                                                 }}/><span>{evt.label}</span></div>
                                                 <div className="muted mono" style={{
                                                     fontSize: 11,
                                                     marginTop: 4
                                                 }}>{new Date(evt.at).toLocaleTimeString()}</div>
                                             </div>)))}</>) : null}
                                 </div>
                                 {vizEventsCollapsed ? (<button type="button" className="viz-events-toggle floating"
                                                                onClick={() => setVizEventsCollapsed(false)}
                                                                title="展开"><ChevronLeft size={16}/></button>) : null}
                             </div>
                         </div>
                         {error ? <div className="toast">{error}</div> : null}
                         <div className="composer">
                             <textarea className="input textarea" value={draft}
                                       onChange={(e) => setDraft(e.target.value)}
                                       placeholder="Type a message… (Ctrl/Cmd+Enter to send)" onKeyDown={(e) => {
                                 if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                     e.preventDefault();
                                     void onSend();
                                 }
                             }}/>
                             <button className="btn btn-primary" onClick={() => void onSend()}
                                     disabled={!draft.trim() || status === "send"}>Send
                             </button>
                         </div>
                     </main>
                 }
                 right={
                     <>
                         <section className="panel panel-right">
                             {rightCollapsed ? rightPanelHeader : (
                                 <>
                                     <div className="header">
                                         <div style={{fontWeight: 700}}>Agent Details</div>
                                         <button type="button" className="btn"
                                                 style={{padding: "4px 8px", fontSize: 11}}
                                                 onClick={() => setRightCollapsed(true)} title="收起"><ChevronRight
                                             size={14}/></button>
                                     </div>
                                     <div className="agent-sidebar-body">
                                         <div className="muted" style={{fontSize: 12}}>Streaming from: <span
                                             className="mono">{streamAgentId ?? "-"}</span></div>
                                         {agentError ? (<div className="toast" style={{
                                             borderColor: "#713f12",
                                             background: "rgba(113,63,18,0.25)",
                                             color: "#fde68a"
                                         }}>{agentError}</div>) : null}
                                         <div className="agent-panels">
                                             {rightPanels.map((panel, idx) => (
                                                 <Fragment key={panel.id}>
                                                     <div className={cx("agent-panel", panel.collapsed && "collapsed")}
                                                          style={panel.collapsed ? {
                                                              flex: `0 0 ${RIGHT_PANEL_HEADER_HEIGHT}px`,
                                                              height: RIGHT_PANEL_HEADER_HEIGHT
                                                          } : {
                                                              flex: `1 1 ${panel.size}px`,
                                                              minHeight: RIGHT_PANEL_MIN_HEIGHT
                                                          }}>
                                                         <button className="agent-panel-header" type="button"
                                                                 onClick={() => toggleRightPanel(panel.id)}><span
                                                             className="agent-panel-caret">{panel.collapsed ? "▸" : "▾"}</span><span>{panel.title}</span>
                                                         </button>
                                                         {!panel.collapsed ? (
                                                             <div className={cx("agent-panel-body", "mono")}>
                                                                 {panel.id === "history" ? (Array.isArray(llmHistoryParsed) ? (
                                                                         <IMHistoryList entries={llmHistoryParsed}
                                                                                        historyRole={historyRole}
                                                                                        historyAccent={historyAccent}
                                                                                        summarizeHistoryEntry={summarizeHistoryEntry}/>) : (
                                                                         <pre style={{
                                                                             margin: 0,
                                                                             whiteSpace: "pre-wrap"
                                                                         }}>{llmHistoryFormatted || "—"}</pre>))
                                                                     : panel.id === "content" ? (
                                                                             <MarkdownContent content={contentStream}/>)
                                                                         : panel.id === "reasoning" ? (<MarkdownContent
                                                                                 content={reasoningStream}/>)
                                                                             : (<MarkdownContent
                                                                                 content={toolStream}/>)}
                                                             </div>) : null}
                                                     </div>
                                                     {idx < rightPanels.length - 1 ? (<div
                                                         className={cx("agent-panel-resizer", (panel.collapsed || rightPanels[idx + 1]?.collapsed) && "disabled")}
                                                         onPointerDown={(e) => handleRightPanelResizeStart(idx, e)}/>) : null}
                                                 </Fragment>
                                             ))}
                                         </div>
                                     </div>
                                 </>
                             )}
                         </section>
                         {showPresetPanel && (<div style={{
                             position: "fixed",
                             inset: 0,
                             background: "rgba(0, 0, 0, 0.7)",
                             backdropFilter: "blur(4px)",
                             display: "flex",
                             alignItems: "center",
                             justifyContent: "center",
                             zIndex: 9999
                         }} onClick={() => setShowPresetPanel(false)}>
                             <div style={{
                                 background: "linear-gradient(135deg, #0a0e27 0%, #1a1a2e 100%)",
                                 border: "1px solid rgba(100, 150, 255, 0.3)",
                                 borderRadius: 12,
                                 padding: 24,
                                 maxWidth: 600,
                                 width: "90%"
                             }} onClick={(e) => e.stopPropagation()}>
                                 <div style={{
                                     display: "flex",
                                     justifyContent: "space-between",
                                     alignItems: "center",
                                     marginBottom: 16
                                 }}><h3 style={{margin: 0, fontSize: 18, fontWeight: 600}}>📊 预设 Agent 类型（只读）</h3>
                                     <button type="button" className="btn" style={{padding: "4px 8px", fontSize: 12}}
                                             onClick={() => setShowPresetPanel(false)}><X size={16}/></button>
                                 </div>
                                 <p className="muted" style={{marginBottom: 16, fontSize: 13}}>以下预设 Agent
                                     只能通过父Agent调用工具创建，不能通过UI直接创建。</p>
                                 <div style={{
                                     display: "grid",
                                     gridTemplateColumns: "repeat(2, 1fr)",
                                     gap: 12
                                 }}>{PRESET_AGENT_ROLES.map((preset) => (<div key={preset.role} style={{
                                     padding: 12,
                                     border: "1px solid rgba(100, 150, 255, 0.2)",
                                     borderRadius: 8,
                                     background: "rgba(10, 14, 39, 0.5)"
                                 }}>
                                     <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 6}}><span
                                         style={{fontSize: 24}}>{preset.icon}</span>
                                         <div>
                                             <div style={{fontWeight: 600, fontSize: 14}}>{preset.name}</div>
                                             <div className="muted mono" style={{fontSize: 11}}>{preset.role}</div>
                                         </div>
                                     </div>
                                     <div className="muted"
                                          style={{fontSize: 12, lineHeight: 1.4}}>{preset.description}</div>
                                 </div>))}</div>
                             </div>
                         </div>)}
                         {showCreateDialog && (<div style={{
                             position: "fixed",
                             inset: 0,
                             background: "rgba(0, 0, 0, 0.7)",
                             backdropFilter: "blur(4px)",
                             display: "flex",
                             alignItems: "center",
                             justifyContent: "center",
                             zIndex: 9999
                         }} onClick={() => {
                             setShowCreateDialog(false);
                             setNewAgentRole("");
                         }}>
                             <div style={{
                                 background: "linear-gradient(135deg, #0a0e27 0%, #1a1a2e 100%)",
                                 border: "1px solid rgba(100, 150, 255, 0.3)",
                                 borderRadius: 12,
                                 padding: 24,
                                 maxWidth: 400,
                                 width: "90%"
                             }} onClick={(e) => e.stopPropagation()}>
                                 <div style={{
                                     display: "flex",
                                     justifyContent: "space-between",
                                     alignItems: "center",
                                     marginBottom: 16
                                 }}><h3 style={{margin: 0, fontSize: 18, fontWeight: 600}}>+ 创建自定义 Agent</h3>
                                     <button type="button" className="btn" style={{padding: "4px 8px", fontSize: 12}}
                                             onClick={() => {
                                                 setShowCreateDialog(false);
                                                 setNewAgentRole("");
                                             }}><X size={16}/></button>
                                 </div>
                                 <p className="muted"
                                    style={{marginBottom: 16, fontSize: 13}}>输入自定义角色名称（不能是预设角色）</p>
                                 <input type="text" className="input" value={newAgentRole}
                                        onChange={(e) => setNewAgentRole(e.target.value)}
                                        placeholder="例如：reviewer, researcher, etc." onKeyDown={(e) => {
                                     if (e.key === "Enter") void createCustomAgent();
                                 }} style={{
                                     width: "100%",
                                     padding: "8px 12px",
                                     marginBottom: 16,
                                     background: "rgba(10, 14, 39, 0.8)",
                                     border: "1px solid rgba(100, 150, 255, 0.3)",
                                     borderRadius: 6,
                                     color: "#e4e4e7",
                                     fontSize: 14
                                 }} autoFocus/>
                                 <div className="muted" style={{marginBottom: 16, fontSize: 12, lineHeight: 1.4}}>🚫
                                     不允许使用的预设角色：
                                     <div style={{
                                         marginTop: 4,
                                         fontFamily: "monospace",
                                         opacity: 0.7
                                     }}>{PRESET_AGENT_ROLES.map(p => p.role).join(", ")}</div>
                                 </div>
                                 <div style={{display: "flex", gap: 8, justifyContent: "flex-end"}}>
                                     <button type="button" className="btn" style={{padding: "6px 16px"}}
                                             onClick={() => {
                                                 setShowCreateDialog(false);
                                                 setNewAgentRole("");
                                             }}>取消
                                     </button>
                                     <button type="button" className="btn" style={{
                                         padding: "6px 16px",
                                         background: "rgba(56, 189, 248, 0.2)",
                                         borderColor: "rgba(56, 189, 248, 0.5)"
                                     }} onClick={() => void createCustomAgent()} disabled={!newAgentRole.trim()}>创建
                                     </button>
                                 </div>
                             </div>
                         </div>)}
                         {viewingAgentHistory && (() => {
                             const agent = agents.find(a => a.id === viewingAgentHistory);
                             if (!agent) return null;
                             const agentMessages = messages.filter(m => m.senderId === viewingAgentHistory);
                             return (<div style={{
                                 position: "fixed",
                                 inset: 0,
                                 background: "rgba(0, 0, 0, 0.7)",
                                 backdropFilter: "blur(4px)",
                                 display: "flex",
                                 alignItems: "center",
                                 justifyContent: "center",
                                 zIndex: 9999
                             }} onClick={() => setViewingAgentHistory(null)}>
                                 <div style={{
                                     background: "linear-gradient(135deg, #0a0e27 0%, #1a1a2e 100%)",
                                     border: "1px solid rgba(100, 150, 255, 0.3)",
                                     borderRadius: 12,
                                     padding: 24,
                                     maxWidth: 700,
                                     width: "90%",
                                     maxHeight: "80vh",
                                     display: "flex",
                                     flexDirection: "column"
                                 }} onClick={(e) => e.stopPropagation()}>
                                     <div style={{
                                         display: "flex",
                                         justifyContent: "space-between",
                                         alignItems: "center",
                                         marginBottom: 16
                                     }}><h3 style={{margin: 0, fontSize: 18, fontWeight: 600}}>📜 {agent.role} -
                                         历史消息</h3>
                                         <button type="button" className="btn"
                                                 style={{padding: "4px 8px", fontSize: 12}}
                                                 onClick={() => setViewingAgentHistory(null)}><X size={16}/></button>
                                     </div>
                                     <div className="muted"
                                          style={{marginBottom: 16, fontSize: 12}}>总共 {agentMessages.length} 条消息
                                     </div>
                                     <div style={{
                                         flex: 1,
                                         overflow: "auto",
                                         borderRadius: 8,
                                         border: "1px solid rgba(100, 150, 255, 0.2)",
                                         background: "rgba(0, 0, 0, 0.3)",
                                         padding: 12
                                     }}>{agentMessages.length === 0 ? (
                                         <div className="muted" style={{textAlign: "center", padding: 32}}>该 Agent
                                             还没有发送过消息</div>) : (agentMessages.map((msg) => (<div key={msg.id}
                                                                                                         style={{
                                                                                                             marginBottom: 12,
                                                                                                             padding: 12,
                                                                                                             borderRadius: 8,
                                                                                                             background: "rgba(59, 130, 246, 0.1)",
                                                                                                             border: "1px solid rgba(59, 130, 246, 0.2)"
                                                                                                         }}>
                                         <div style={{
                                             display: "flex",
                                             justifyContent: "space-between",
                                             alignItems: "center",
                                             marginBottom: 8
                                         }}>
                                             <div style={{
                                                 fontSize: 12,
                                                 fontWeight: 600,
                                                 color: "#60a5fa"
                                             }}>{agent.role}</div>
                                             <div className="muted mono"
                                                  style={{fontSize: 10}}>{fmtTime(msg.sendTime)}</div>
                                         </div>
                                         <div style={{fontSize: 13, lineHeight: 1.5, color: "#e2e8f0"}}><MarkdownContent
                                             content={msg.content}/></div>
                                     </div>)))}</div>
                                     <div style={{marginTop: 16, display: "flex", justifyContent: "flex-end"}}>
                                         <button type="button" className="btn" style={{padding: "6px 16px"}}
                                                 onClick={() => setViewingAgentHistory(null)}>关闭
                                         </button>
                                     </div>
                                 </div>
                             </div>);
                         })()}
                     </>
                 }
        />
    );
}
