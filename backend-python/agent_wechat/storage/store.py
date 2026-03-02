"""Data access layer - translates storage.ts to Python."""

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import and_, desc, func, select, delete, update
from sqlalchemy.orm import Session

from ..db.engine import create_session
from ..db.models import Agent, Group, GroupMember, Message, Workspace
from ..utils import generate_uuid


# Preset Agent role configurations
PRESET_AGENT_CONFIGS: dict[str, dict[str, str]] = {
    "coder": {
        "name": "代码工程师",
        "prompt": """You are a professional software engineer specializing in coding, code review, and technical problem-solving.

Your responsibilities:
- Write clean, maintainable, and efficient code
- Review code for bugs, security issues, and best practices
- Debug technical problems and provide solutions
- Follow coding standards and design patterns
- Collaborate with other team members on technical tasks

Be precise, technical, and solution-oriented in your responses.""",
    },
    "productmanager": {
        "name": "产品经理",
        "prompt": """You are an experienced Product Manager responsible for product strategy, requirements analysis, and roadmap planning.

Your responsibilities:
- Analyze user needs and translate them into product requirements
- Define product features and prioritize the backlog
- Create user stories and acceptance criteria
- Coordinate with design, engineering, and business teams
- Track product metrics and iterate on features

Be strategic, user-focused, and data-driven in your approach.""",
    },
    "designer": {
        "name": "设计师",
        "prompt": """You are a UI/UX Designer focused on creating intuitive, beautiful, and user-friendly interfaces.

Your responsibilities:
- Design user interfaces and user experiences
- Create wireframes, mockups, and prototypes
- Ensure design consistency and accessibility
- Conduct user research and usability testing
- Collaborate with product and engineering teams

Be creative, user-centric, and detail-oriented in your designs.""",
    },
    "tester": {
        "name": "测试工程师",
        "prompt": """You are a Quality Assurance Engineer responsible for ensuring product quality through comprehensive testing.

Your responsibilities:
- Design and execute test plans and test cases
- Identify, document, and track bugs
- Perform functional, regression, and performance testing
- Automate tests where possible
- Ensure quality standards are met before release

Be thorough, systematic, and quality-focused in your testing approach.""",
    },
    "analyst": {
        "name": "数据分析师",
        "prompt": """You are a Data Analyst specializing in analyzing data to drive business insights and decisions.

Your responsibilities:
- Analyze data and identify trends and patterns
- Create reports and visualizations
- Provide actionable insights and recommendations
- Work with metrics and KPIs
- Support data-driven decision making

Be analytical, detail-oriented, and insight-driven in your analysis.""",
    },
}


def _now_timestamp() -> int:
    """Get current timestamp in milliseconds."""
    return int(datetime.now().timestamp() * 1000)


def _timestamp_to_iso(ts: int) -> str:
    """Convert millisecond timestamp to ISO string."""
    return datetime.fromtimestamp(ts / 1000).isoformat()


def _initial_agent_history(
    agent_id: str,
    workspace_id: str,
    role: str,
    guidance: Optional[str] = None,
) -> str:
    """Generate initial LLM history for an agent."""
    base_content = (
        f"You are an agent in an IM system.\n"
        f"Your agent_id is: {agent_id}.\n"
        f"Your workspace_id is: {workspace_id}.\n"
        f"Your role is: {role}.\n"
        f"Act strictly as this role when replying. Be concise and helpful.\n"
        f"Your replies are NOT automatically delivered to humans.\n"
        f"To send messages, you MUST call tools like send_group_message or send_direct_message.\n"
        f"If you need to coordinate with other agents, you may use tools like self, list_agents, "
        f"create, send, list_groups, list_group_members, create_group, send_group_message, "
        f"send_direct_message, and get_group_messages."
    )

    history: list[dict[str, str]] = [{"role": "system", "content": base_content}]

    # Add preset prompt if available
    preset_config = PRESET_AGENT_CONFIGS.get(role)
    if preset_config:
        history.append({
            "role": "system",
            "content": f"Role-specific instructions ({preset_config['name']}):\n{preset_config['prompt']}",
        })

    # Add custom guidance
    if guidance and guidance.strip():
        history.append({
            "role": "system",
            "content": f"Additional instructions:\n{guidance.strip()}",
        })

    return json.dumps(history)


class Store:
    """Data access layer for all database operations."""

    def _get_session(self) -> Session:
        """Get a new database session."""
        return create_session()

    # ==================== Workspace Operations ====================

    def list_workspaces(self) -> list[dict[str, Any]]:
        """List all workspaces ordered by creation time (newest first)."""
        with self._get_session() as session:
            stmt = select(Workspace).order_by(desc(Workspace.created_at))
            workspaces = session.execute(stmt).scalars().all()
            return [
                {
                    "id": w.id,
                    "name": w.name,
                    "createdAt": _timestamp_to_iso(w.created_at),
                }
                for w in workspaces
            ]

    def create_workspace_with_defaults(self, name: str) -> dict[str, str]:
        """Create a new workspace with default human and assistant agents."""
        with self._get_session() as session:
            workspace_id = generate_uuid()
            human_agent_id = generate_uuid()
            assistant_agent_id = generate_uuid()
            default_group_id = generate_uuid()
            created_at = _now_timestamp()

            # Create workspace
            workspace = Workspace(
                id=workspace_id,
                name=name,
                created_at=created_at,
            )
            session.add(workspace)

            # Create human agent
            human_agent = Agent(
                id=human_agent_id,
                workspace_id=workspace_id,
                role="human",
                parent_id=None,
                llm_history=_initial_agent_history(human_agent_id, workspace_id, "human"),
                created_at=created_at,
            )
            session.add(human_agent)

            # Create assistant agent
            assistant_agent = Agent(
                id=assistant_agent_id,
                workspace_id=workspace_id,
                role="assistant",
                parent_id=None,
                llm_history=_initial_agent_history(assistant_agent_id, workspace_id, "assistant"),
                created_at=created_at,
            )
            session.add(assistant_agent)

            # Create default group
            default_group = Group(
                id=default_group_id,
                workspace_id=workspace_id,
                name=None,
                is_default=True,
                created_at=created_at,
            )
            session.add(default_group)

            # Add members to default group
            session.add(GroupMember(
                group_id=default_group_id,
                user_id=human_agent_id,
                last_read_message_id=None,
                joined_at=created_at,
            ))
            session.add(GroupMember(
                group_id=default_group_id,
                user_id=assistant_agent_id,
                last_read_message_id=None,
                joined_at=created_at,
            ))

            session.commit()

            return {
                "workspaceId": workspace_id,
                "humanAgentId": human_agent_id,
                "assistantAgentId": assistant_agent_id,
                "defaultGroupId": default_group_id,
            }

    def ensure_workspace_defaults(self, workspace_id: str) -> dict[str, str]:
        """Ensure workspace has default human and assistant agents and a default group."""
        with self._get_session() as session:
            # Verify workspace exists
            workspace = session.get(Workspace, workspace_id)
            if not workspace:
                raise ValueError("workspace not found")

            created_at = _now_timestamp()

            # Find existing agents
            stmt = select(Agent).where(Agent.workspace_id == workspace_id)
            existing_agents = session.execute(stmt).scalars().all()
            agents_by_role = {a.role: a for a in existing_agents}

            human_agent_id = agents_by_role.get("human", {}).id if "human" in agents_by_role else None
            assistant_agent_id = agents_by_role.get("assistant", {}).id if "assistant" in agents_by_role else None

            # Create human if missing
            if not human_agent_id:
                human_agent_id = generate_uuid()
                session.add(Agent(
                    id=human_agent_id,
                    workspace_id=workspace_id,
                    role="human",
                    parent_id=None,
                    llm_history=_initial_agent_history(human_agent_id, workspace_id, "human"),
                    created_at=created_at,
                ))

            # Create assistant if missing
            if not assistant_agent_id:
                assistant_agent_id = generate_uuid()
                session.add(Agent(
                    id=assistant_agent_id,
                    workspace_id=workspace_id,
                    role="assistant",
                    parent_id=None,
                    llm_history=_initial_agent_history(assistant_agent_id, workspace_id, "assistant"),
                    created_at=created_at,
                ))

            # Find or create default group with both agents
            # Query for groups with exactly these two members
            subq = (
                select(GroupMember.group_id)
                .where(GroupMember.user_id.in_([human_agent_id, assistant_agent_id]))
                .group_by(GroupMember.group_id)
                .having(func.count() == 2)
            )
            stmt = (
                select(Group)
                .where(and_(
                    Group.workspace_id == workspace_id,
                    Group.id.in_(subq),
                ))
                .order_by(desc(Group.created_at))
                .limit(1)
            )
            existing_group = session.execute(stmt).scalars().first()
            default_group_id = existing_group.id if existing_group else None

            if not default_group_id:
                default_group_id = generate_uuid()
                session.add(Group(
                    id=default_group_id,
                    workspace_id=workspace_id,
                    name=None,
                    is_default=True,
                    created_at=created_at,
                ))
                session.add(GroupMember(
                    group_id=default_group_id,
                    user_id=human_agent_id,
                    last_read_message_id=None,
                    joined_at=created_at,
                ))
                session.add(GroupMember(
                    group_id=default_group_id,
                    user_id=assistant_agent_id,
                    last_read_message_id=None,
                    joined_at=created_at,
                ))

            session.commit()

            return {
                "workspaceId": workspace_id,
                "humanAgentId": human_agent_id,
                "assistantAgentId": assistant_agent_id,
                "defaultGroupId": default_group_id,
            }

    def delete_workspace(self, workspace_id: str) -> dict[str, Any]:
        """Delete a workspace and all its data."""
        with self._get_session() as session:
            # Delete messages
            session.execute(delete(Message).where(Message.workspace_id == workspace_id))

            # Get all groups in workspace
            stmt = select(Group.id).where(Group.workspace_id == workspace_id)
            group_ids = [gid for gid in session.execute(stmt).scalars().all()]

            # Delete group members
            for gid in group_ids:
                session.execute(delete(GroupMember).where(GroupMember.group_id == gid))

            # Delete groups
            session.execute(delete(Group).where(Group.workspace_id == workspace_id))

            # Delete agents
            session.execute(delete(Agent).where(Agent.workspace_id == workspace_id))

            # Delete workspace
            session.execute(delete(Workspace).where(Workspace.id == workspace_id))

            session.commit()

            return {"success": True, "deletedWorkspaceId": workspace_id}

    # ==================== Agent Operations ====================

    def create_agent(
        self,
        workspace_id: str,
        role: str,
        parent_id: Optional[str] = None,
        llm_history: Optional[str] = None,
        guidance: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a new agent."""
        with self._get_session() as session:
            # Verify workspace exists
            workspace = session.get(Workspace, workspace_id)
            if not workspace:
                raise ValueError("workspace not found")

            agent_id = generate_uuid()
            created_at = _now_timestamp()

            agent = Agent(
                id=agent_id,
                workspace_id=workspace_id,
                role=role,
                parent_id=parent_id,
                llm_history=llm_history or _initial_agent_history(agent_id, workspace_id, role, guidance),
                created_at=created_at,
            )
            session.add(agent)
            session.commit()

            return {
                "id": agent_id,
                "role": role,
                "createdAt": _timestamp_to_iso(created_at),
            }

    def create_sub_agent_with_p2p(
        self,
        workspace_id: str,
        creator_id: str,
        role: str,
        guidance: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a sub-agent with a P2P group to human."""
        with self._get_session() as session:
            # Ensure workspace defaults exist
            defaults = self.ensure_workspace_defaults(workspace_id)
            human_agent_id = defaults["humanAgentId"]

            # Verify workspace exists
            workspace = session.get(Workspace, workspace_id)
            if not workspace:
                raise ValueError("workspace not found")

            agent_id = generate_uuid()
            group_id = generate_uuid()
            created_at = _now_timestamp()

            # Create agent
            agent = Agent(
                id=agent_id,
                workspace_id=workspace_id,
                role=role,
                parent_id=creator_id,
                llm_history=_initial_agent_history(agent_id, workspace_id, role, guidance),
                created_at=created_at,
            )
            session.add(agent)

            # Create P2P group
            group = Group(
                id=group_id,
                workspace_id=workspace_id,
                name=role,
                is_default=False,
                created_at=created_at,
            )
            session.add(group)

            # Add members
            session.add(GroupMember(
                group_id=group_id,
                user_id=human_agent_id,
                last_read_message_id=None,
                joined_at=created_at,
            ))
            session.add(GroupMember(
                group_id=group_id,
                user_id=agent_id,
                last_read_message_id=None,
                joined_at=created_at,
            ))

            session.commit()

            return {
                "agentId": agent_id,
                "groupId": group_id,
                "createdAt": _timestamp_to_iso(created_at),
            }

    def list_agents_meta(self, workspace_id: str) -> list[dict[str, Any]]:
        """List all agents in a workspace (metadata only)."""
        with self._get_session() as session:
            stmt = (
                select(Agent)
                .where(Agent.workspace_id == workspace_id)
                .order_by(desc(Agent.created_at))
            )
            agents = session.execute(stmt).scalars().all()
            return [
                {
                    "id": a.id,
                    "role": a.role,
                    "parentId": a.parent_id,
                    "createdAt": _timestamp_to_iso(a.created_at),
                }
                for a in agents
            ]

    def list_agents(self, workspace_id: Optional[str] = None) -> list[dict[str, Any]]:
        """List all agents, optionally filtered by workspace."""
        with self._get_session() as session:
            stmt = select(Agent).order_by(desc(Agent.created_at))
            if workspace_id:
                stmt = stmt.where(Agent.workspace_id == workspace_id)
            agents = session.execute(stmt).scalars().all()
            return [
                {
                    "id": a.id,
                    "workspaceId": a.workspace_id,
                    "role": a.role,
                    "llmHistory": a.llm_history,
                }
                for a in agents
            ]

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        """Get an agent by ID."""
        with self._get_session() as session:
            agent = session.get(Agent, agent_id)
            if not agent:
                raise ValueError("agent not found")
            return {
                "id": agent.id,
                "role": agent.role,
                "llmHistory": agent.llm_history,
                "workspaceId": agent.workspace_id,
            }

    def get_agent_role(self, agent_id: str) -> str:
        """Get an agent's role."""
        agent = self.get_agent(agent_id)
        return agent["role"]

    def set_agent_history(
        self,
        agent_id: str,
        llm_history: str,
        workspace_id: Optional[str] = None,
    ) -> None:
        """Update an agent's LLM history."""
        with self._get_session() as session:
            stmt = update(Agent).where(Agent.id == agent_id).values(llm_history=llm_history)
            session.execute(stmt)
            session.commit()

    def get_default_human_agent_id(self, workspace_id: str) -> Optional[str]:
        """Get the default human agent ID for a workspace."""
        agents = self.list_agents_meta(workspace_id)
        for a in agents:
            if a["role"] == "human":
                return a["id"]
        return None

    def delete_agent(self, agent_id: str) -> dict[str, Any]:
        """Delete an agent and clean up related data."""
        with self._get_session() as session:
            # Get agent info
            agent = session.get(Agent, agent_id)
            if not agent:
                raise ValueError("agent not found")

            # Find groups this agent is in
            stmt = select(GroupMember.group_id).where(GroupMember.user_id == agent_id)
            agent_group_ids = list(session.execute(stmt).scalars().all())

            groups_to_delete = []
            for gid in agent_group_ids:
                group = session.get(Group, gid)
                if not group or group.is_default:
                    continue

                # Check if other non-human members exist
                stmt = select(GroupMember).where(
                    and_(GroupMember.group_id == gid, GroupMember.user_id != agent_id)
                )
                other_members = session.execute(stmt).scalars().all()

                has_non_human = False
                for member in other_members:
                    member_agent = session.get(Agent, member.user_id)
                    if member_agent and member_agent.role != "human":
                        has_non_human = True
                        break

                if not has_non_human:
                    groups_to_delete.append(gid)

            # Delete group memberships
            session.execute(delete(GroupMember).where(GroupMember.user_id == agent_id))

            # Delete messages from agent
            session.execute(delete(Message).where(Message.sender_id == agent_id))

            # Delete agent
            session.execute(delete(Agent).where(Agent.id == agent_id))

            # Delete empty groups
            for gid in groups_to_delete:
                session.execute(delete(Message).where(Message.group_id == gid))
                session.execute(delete(GroupMember).where(GroupMember.group_id == gid))
                session.execute(delete(Group).where(Group.id == gid))

            session.commit()

            return {
                "success": True,
                "deletedAgentId": agent_id,
                "deletedGroupsCount": len(groups_to_delete),
            }

    # ==================== Group Operations ====================

    def create_group(
        self,
        workspace_id: str,
        member_ids: list[str],
        name: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a new group with members."""
        with self._get_session() as session:
            group_id = generate_uuid()
            created_at = _now_timestamp()

            group = Group(
                id=group_id,
                workspace_id=workspace_id,
                name=name,
                is_default=False,
                created_at=created_at,
            )
            session.add(group)

            for uid in member_ids:
                session.add(GroupMember(
                    group_id=group_id,
                    user_id=uid,
                    last_read_message_id=None,
                    joined_at=created_at,
                ))

            session.commit()

            return {
                "id": group_id,
                "name": name,
                "createdAt": _timestamp_to_iso(created_at),
            }

    def delete_group(self, group_id: str) -> None:
        """Delete a group and its messages."""
        with self._get_session() as session:
            group = session.get(Group, group_id)
            if not group:
                raise ValueError("Group not found")

            # Delete messages
            session.execute(delete(Message).where(Message.group_id == group_id))

            # Delete members
            session.execute(delete(GroupMember).where(GroupMember.group_id == group_id))

            # Delete group
            session.execute(delete(Group).where(Group.id == group_id))

            session.commit()

    def add_group_members(self, group_id: str, user_ids: list[str]) -> None:
        """Add members to a group."""
        if not user_ids:
            return

        with self._get_session() as session:
            group = session.get(Group, group_id)
            if not group:
                raise ValueError("group not found")

            joined_at = _now_timestamp()
            for uid in user_ids:
                # Check if already a member
                stmt = select(GroupMember).where(
                    and_(GroupMember.group_id == group_id, GroupMember.user_id == uid)
                )
                existing = session.execute(stmt).scalars().first()
                if not existing:
                    session.add(GroupMember(
                        group_id=group_id,
                        user_id=uid,
                        last_read_message_id=None,
                        joined_at=joined_at,
                    ))

            session.commit()

    def list_group_member_ids(self, group_id: str) -> list[str]:
        """List member IDs for a group."""
        with self._get_session() as session:
            stmt = select(GroupMember.user_id).where(GroupMember.group_id == group_id)
            return list(session.execute(stmt).scalars().all())

    def get_group_workspace_id(self, group_id: str) -> str:
        """Get the workspace ID for a group."""
        with self._get_session() as session:
            group = session.get(Group, group_id)
            if not group:
                raise ValueError("group not found")
            return group.workspace_id

    def find_latest_exact_p2p_group_id(
        self,
        workspace_id: str,
        member_a: str,
        member_b: str,
        preferred_name: Optional[str] = None,
    ) -> Optional[str]:
        """Find the latest P2P group between two members."""
        if not member_a or not member_b or member_a == member_b:
            return None

        with self._get_session() as session:
            # Find groups with exactly these two members
            subq = (
                select(GroupMember.group_id)
                .where(GroupMember.user_id.in_([member_a, member_b]))
                .group_by(GroupMember.group_id)
                .having(func.count() == 2)
            )

            # Count total members to ensure exactly 2
            member_count_subq = (
                select(GroupMember.group_id)
                .group_by(GroupMember.group_id)
                .having(func.count() == 2)
            )

            stmt = (
                select(Group)
                .where(and_(
                    Group.workspace_id == workspace_id,
                    Group.id.in_(subq),
                    Group.id.in_(member_count_subq),
                ))
            )
            groups = session.execute(stmt).scalars().all()

            if not groups:
                return None

            # Sort by preference
            def sort_key(g: Group):
                name_match = 1 if preferred_name and g.name == preferred_name else 0
                has_name = 1 if g.name else 0
                return (-name_match, -has_name, -g.created_at)

            groups_sorted = sorted(groups, key=sort_key)
            return groups_sorted[0].id if groups_sorted else None

    def merge_duplicate_exact_p2p_groups(
        self,
        workspace_id: str,
        member_a: str,
        member_b: str,
        preferred_name: Optional[str] = None,
    ) -> Optional[str]:
        """Merge duplicate P2P groups, keeping the best one."""
        if not member_a or not member_b or member_a == member_b:
            return None

        with self._get_session() as session:
            created_at = _now_timestamp()

            # Find all P2P groups between these members
            subq = (
                select(GroupMember.group_id)
                .where(GroupMember.user_id.in_([member_a, member_b]))
                .group_by(GroupMember.group_id)
                .having(func.count() == 2)
            )

            member_count_subq = (
                select(GroupMember.group_id)
                .group_by(GroupMember.group_id)
                .having(func.count() == 2)
            )

            stmt = (
                select(Group)
                .where(and_(
                    Group.workspace_id == workspace_id,
                    Group.id.in_(subq),
                    Group.id.in_(member_count_subq),
                ))
            )
            groups = session.execute(stmt).scalars().all()

            if not groups:
                # Create new group
                group_id = generate_uuid()
                session.add(Group(
                    id=group_id,
                    workspace_id=workspace_id,
                    name=preferred_name,
                    is_default=False,
                    created_at=created_at,
                ))
                session.add(GroupMember(
                    group_id=group_id,
                    user_id=member_a,
                    last_read_message_id=None,
                    joined_at=created_at,
                ))
                session.add(GroupMember(
                    group_id=group_id,
                    user_id=member_b,
                    last_read_message_id=None,
                    joined_at=created_at,
                ))
                session.commit()
                return group_id

            # Sort to find best group
            def sort_key(g: Group):
                name_match = 1 if preferred_name and g.name == preferred_name else 0
                has_name = 1 if g.name else 0
                return (-name_match, -has_name, -g.created_at)

            groups_sorted = sorted(groups, key=sort_key)
            keep_group = groups_sorted[0]
            keep_id = keep_group.id

            # Merge other groups into this one
            other_ids = [g.id for g in groups_sorted[1:]]
            for other_id in other_ids:
                # Move messages
                session.execute(
                    update(Message)
                    .where(and_(Message.workspace_id == workspace_id, Message.group_id == other_id))
                    .values(group_id=keep_id)
                )
                # Delete members
                session.execute(delete(GroupMember).where(GroupMember.group_id == other_id))
                # Delete group
                session.execute(delete(Group).where(Group.id == other_id))

            # Update name if needed
            if preferred_name and keep_group.name != preferred_name:
                session.execute(
                    update(Group).where(Group.id == keep_id).values(name=preferred_name)
                )

            session.commit()
            return keep_id

    def find_latest_exact_group_id(
        self,
        workspace_id: str,
        member_ids: list[str],
    ) -> Optional[str]:
        """Find the latest group with exactly these members."""
        ids = list(set(filter(None, member_ids)))
        if not ids:
            return None

        with self._get_session() as session:
            # Find groups with exactly these members
            subq = (
                select(GroupMember.group_id)
                .where(GroupMember.user_id.in_(ids))
                .group_by(GroupMember.group_id)
                .having(func.count(GroupMember.user_id.distinct()) == len(ids))
            )

            # Ensure total member count matches
            member_count_subq = (
                select(GroupMember.group_id)
                .group_by(GroupMember.group_id)
                .having(func.count() == len(ids))
            )

            stmt = (
                select(Group)
                .where(and_(
                    Group.workspace_id == workspace_id,
                    Group.id.in_(subq),
                    Group.id.in_(member_count_subq),
                ))
                .order_by(desc(Group.created_at))
                .limit(1)
            )
            group = session.execute(stmt).scalars().first()
            return group.id if group else None

    def list_groups(
        self,
        workspace_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List groups, optionally filtered by workspace and/or agent."""
        with self._get_session() as session:
            if agent_id:
                # Get groups the agent is a member of
                member_stmt = select(GroupMember.group_id).where(GroupMember.user_id == agent_id)
                group_ids = list(session.execute(member_stmt).scalars().all())

                stmt = select(Group).where(Group.id.in_(group_ids))
                if workspace_id:
                    stmt = stmt.where(Group.workspace_id == workspace_id)
                stmt = stmt.order_by(desc(Group.created_at))
            else:
                stmt = select(Group)
                if workspace_id:
                    stmt = stmt.where(Group.workspace_id == workspace_id)
                stmt = stmt.order_by(desc(Group.created_at))

            groups = session.execute(stmt).scalars().all()

            result = []
            for g in groups:
                # Get members
                member_stmt = select(GroupMember.user_id).where(GroupMember.group_id == g.id)
                member_ids = list(session.execute(member_stmt).scalars().all())

                # Get last message
                msg_stmt = (
                    select(Message)
                    .where(Message.group_id == g.id)
                    .order_by(desc(Message.send_time))
                    .limit(1)
                )
                last_msg = session.execute(msg_stmt).scalars().first()

                # Calculate unread count for agent
                unread_count = 0
                if agent_id:
                    gm_stmt = select(GroupMember).where(
                        and_(GroupMember.group_id == g.id, GroupMember.user_id == agent_id)
                    )
                    membership = session.execute(gm_stmt).scalars().first()
                    if membership:
                        last_read_id = membership.last_read_message_id
                        if not last_read_id:
                            count_stmt = (
                                select(func.count())
                                .select_from(Message)
                                .where(and_(
                                    Message.group_id == g.id,
                                    Message.sender_id != agent_id,
                                ))
                            )
                        else:
                            # Get last read message time
                            last_read_msg = session.get(Message, last_read_id)
                            cutoff = last_read_msg.send_time if last_read_msg else 0
                            count_stmt = (
                                select(func.count())
                                .select_from(Message)
                                .where(and_(
                                    Message.group_id == g.id,
                                    Message.send_time > cutoff,
                                    Message.sender_id != agent_id,
                                ))
                            )
                        unread_count = session.execute(count_stmt).scalar() or 0

                updated_at = last_msg.send_time if last_msg else g.created_at

                result.append({
                    "id": g.id,
                    "name": g.name,
                    "memberIds": member_ids,
                    "unreadCount": unread_count,
                    "contextTokens": g.context_tokens or 0,
                    "lastMessage": {
                        "content": last_msg.content,
                        "contentType": last_msg.content_type,
                        "sendTime": _timestamp_to_iso(last_msg.send_time),
                        "senderId": last_msg.sender_id,
                    } if last_msg else None,
                    "updatedAt": _timestamp_to_iso(updated_at),
                    "createdAt": _timestamp_to_iso(g.created_at),
                })

            # Sort by updated_at descending
            result.sort(key=lambda x: x["updatedAt"], reverse=True)
            return result

    def set_group_context_tokens(self, group_id: str, tokens: int) -> dict[str, int]:
        """Update the context tokens for a group."""
        with self._get_session() as session:
            group = session.get(Group, group_id)
            if not group:
                raise ValueError("group not found")

            session.execute(
                update(Group).where(Group.id == group_id).values(context_tokens=tokens)
            )
            session.commit()

            return {"contextTokens": tokens}

    # ==================== Message Operations ====================

    def list_messages(self, group_id: str) -> list[dict[str, Any]]:
        """List all messages in a group."""
        with self._get_session() as session:
            stmt = (
                select(Message)
                .where(Message.group_id == group_id)
                .order_by(Message.send_time)
            )
            messages = session.execute(stmt).scalars().all()
            return [
                {
                    "id": m.id,
                    "senderId": m.sender_id,
                    "content": m.content,
                    "contentType": m.content_type,
                    "sendTime": _timestamp_to_iso(m.send_time),
                }
                for m in messages
            ]

    def send_message(
        self,
        group_id: str,
        sender_id: str,
        content: str,
        content_type: str = "text",
    ) -> dict[str, Any]:
        """Send a message to a group."""
        with self._get_session() as session:
            group = session.get(Group, group_id)
            if not group:
                raise ValueError("group not found")

            message_id = generate_uuid()
            send_time = _now_timestamp()

            message = Message(
                id=message_id,
                workspace_id=group.workspace_id,
                group_id=group_id,
                sender_id=sender_id,
                content_type=content_type,
                content=content,
                send_time=send_time,
            )
            session.add(message)
            session.commit()

            return {
                "id": message_id,
                "sendTime": _timestamp_to_iso(send_time),
            }

    def send_direct_message(
        self,
        workspace_id: str,
        from_id: str,
        to_id: str,
        content: str,
        content_type: str = "text",
        observer_human_id: Optional[str] = None,
        group_name: Optional[str] = None,
        new_thread: bool = False,
    ) -> dict[str, Any]:
        """Send a direct message, creating or reusing a group."""
        member_ids = [from_id, to_id]
        if observer_human_id and observer_human_id not in member_ids:
            member_ids.append(observer_human_id)

        if new_thread:
            group = self.create_group(workspace_id, member_ids, group_name)
            group_id = group["id"]
            channel = "new_thread"
        elif len(member_ids) == 2:
            existing = self.find_latest_exact_p2p_group_id(
                workspace_id, member_ids[0], member_ids[1], group_name
            )
            group_id = self.merge_duplicate_exact_p2p_groups(
                workspace_id, member_ids[0], member_ids[1], group_name
            )
            if not group_id:
                group = self.create_group(workspace_id, member_ids, group_name)
                group_id = group["id"]
            channel = "reuse_existing_group" if existing else "new_group"
        else:
            existing = self.find_latest_exact_group_id(workspace_id, member_ids)
            if existing:
                group_id = existing
                channel = "reuse_existing_group"
            else:
                group = self.create_group(workspace_id, member_ids, group_name)
                group_id = group["id"]
                channel = "new_group"

        message = self.send_message(group_id, from_id, content, content_type)

        return {
            "groupId": group_id,
            "messageId": message["id"],
            "sendTime": message["sendTime"],
            "channel": channel,
        }

    def mark_group_read(self, group_id: str, reader_id: str) -> None:
        """Mark all messages in a group as read for an agent."""
        with self._get_session() as session:
            # Get last message
            stmt = (
                select(Message.id)
                .where(Message.group_id == group_id)
                .order_by(desc(Message.send_time))
                .limit(1)
            )
            last_id = session.execute(stmt).scalars().first()

            session.execute(
                update(GroupMember)
                .where(and_(GroupMember.group_id == group_id, GroupMember.user_id == reader_id))
                .values(last_read_message_id=last_id)
            )
            session.commit()

    def mark_group_read_to_message(
        self,
        group_id: str,
        reader_id: str,
        message_id: str,
    ) -> None:
        """Mark messages up to a specific message as read."""
        with self._get_session() as session:
            session.execute(
                update(GroupMember)
                .where(and_(GroupMember.group_id == group_id, GroupMember.user_id == reader_id))
                .values(last_read_message_id=message_id)
            )
            session.commit()

    def list_unread_by_group(self, agent_id: str) -> list[dict[str, Any]]:
        """List unread messages for an agent, grouped by group."""
        with self._get_session() as session:
            # Get all groups the agent is a member of
            stmt = select(GroupMember).where(GroupMember.user_id == agent_id)
            memberships = session.execute(stmt).scalars().all()

            result = []
            for m in memberships:
                # Get cutoff time
                cutoff = 0
                if m.last_read_message_id:
                    last_read = session.get(Message, m.last_read_message_id)
                    if last_read:
                        cutoff = last_read.send_time

                # Get unread messages
                msg_stmt = (
                    select(Message)
                    .where(and_(
                        Message.group_id == m.group_id,
                        Message.send_time > cutoff,
                        Message.sender_id != agent_id,
                    ))
                    .order_by(Message.send_time)
                )
                messages = session.execute(msg_stmt).scalars().all()

                if messages:
                    result.append({
                        "groupId": m.group_id,
                        "messages": [
                            {
                                "id": msg.id,
                                "senderId": msg.sender_id,
                                "contentType": msg.content_type,
                                "content": msg.content,
                                "sendTime": _timestamp_to_iso(msg.send_time),
                            }
                            for msg in messages
                        ],
                    })

            return result

    def list_recent_workspace_messages(
        self,
        workspace_id: str,
        limit: int = 2000,
    ) -> list[dict[str, Any]]:
        """List recent messages in a workspace."""
        limit = max(1, min(5000, limit))

        with self._get_session() as session:
            stmt = (
                select(Message)
                .where(Message.workspace_id == workspace_id)
                .order_by(desc(Message.send_time))
                .limit(limit)
            )
            messages = session.execute(stmt).scalars().all()
            return [
                {
                    "id": m.id,
                    "groupId": m.group_id,
                    "senderId": m.sender_id,
                    "sendTime": _timestamp_to_iso(m.send_time),
                }
                for m in messages
            ]


# Global store instance
store = Store()
