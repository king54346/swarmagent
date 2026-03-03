"""Agent tools using LangChain @tool decorator."""

import asyncio
import logging
import subprocess
from pathlib import Path
from typing import Annotated, Optional

from langchain_core.tools import tool
from pydantic import Field

from ..storage.store import store
from ..config import get_settings

logger = logging.getLogger(__name__)


# Builtin tool names
BUILTIN_TOOL_NAMES = {
    "self_info",
    "create_agent",
    "list_agents",
    "send_message",
    "list_groups",
    "list_group_members",
    "create_group",
    "send_group_message",
    "send_direct_message",
    "get_group_messages",
    "bash",
}


def create_agent_tools(agent_id: str, workspace_id: str):
    """Create tools bound to a specific agent and workspace."""

    @tool
    def self_info() -> dict:
        """Return the current agent's identity (agent_id, workspace_id, role)."""
        try:
            agent = store.get_agent(agent_id)
            return {
                "ok": True,
                "agentId": agent_id,
                "workspaceId": workspace_id,
                "role": agent["role"],
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def create_agent(
        role: Annotated[str, Field(description="The role name for the sub-agent, e.g. 'CTO', 'CEO', 'CFO', 'Engineer', 'Designer'")],
        guidance: Annotated[Optional[str], Field(description="Optional custom instructions for the sub-agent")] = None,
    ) -> dict:
        """Create a sub-agent with the specified role. You MUST provide the role parameter.
        
        Example usage:
        - create_agent(role="CTO") - creates a CTO sub-agent
        - create_agent(role="CEO", guidance="Focus on strategy") - creates a CEO with custom guidance
        
        Returns:
            dict with ok=True and agentId, groupId on success, or ok=False and error on failure
        """
        logger.info(f"create_agent called with role={role}, guidance={guidance}")
        
        if not role:
            logger.warning("create_agent: Missing role parameter")
            return {"ok": False, "error": "Missing role parameter. Please provide a role name like 'CTO', 'CEO', or 'CFO'."}
        
        role_str = str(role).strip()
        if not role_str:
            logger.warning("create_agent: Empty role parameter")
            return {"ok": False, "error": "Empty role parameter. Please provide a non-empty role name."}
        
        try:
            logger.info(f"Creating sub-agent with role={role_str} in workspace={workspace_id}")
            created = store.create_sub_agent_with_p2p(
                workspace_id=workspace_id,
                creator_id=agent_id,
                role=role_str,
                guidance=guidance,
            )
            logger.info(f"Successfully created agent: {created}")
            return {
                "ok": True,
                "agentId": created["agentId"],
                "role": role_str,
                "groupId": created["groupId"],
            }
        except Exception as e:
            logger.exception(f"create_agent failed: {e}")
            return {"ok": False, "error": f"Failed to create agent: {str(e)}"}

    @tool
    def list_agents() -> dict:
        """List all agents in the current workspace (ids + roles)."""
        try:
            agents = store.list_agents_meta(workspace_id)
            return {"ok": True, "agents": agents}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def send_message(to: str, content: str) -> dict:
        """Send a direct message to another agent_id."""
        if not to or not to.strip():
            return {"ok": False, "error": "Missing to"}
        if not content or not content.strip():
            return {"ok": False, "error": "Missing content"}

        try:
            delivered = store.send_direct_message(
                workspace_id=workspace_id,
                from_id=agent_id,
                to_id=to.strip(),
                content=content.strip(),
                content_type="text",
            )
            return {"ok": True, **delivered}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def list_groups() -> dict:
        """List visible groups for this agent."""
        try:
            groups = store.list_groups(workspace_id=workspace_id, agent_id=agent_id)
            return {"ok": True, "groups": groups}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def list_group_members(group_id: str) -> dict:
        """List member ids for a group."""
        if not group_id or not group_id.strip():
            return {"ok": False, "error": "Missing groupId"}

        try:
            members = store.list_group_member_ids(group_id.strip())
            if agent_id not in members:
                return {"ok": False, "error": "Access denied"}
            return {"ok": True, "members": members}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def create_group(member_ids: list[str], name: Optional[str] = None) -> dict:
        """Create a group with the given member ids."""
        if len(member_ids) < 2:
            return {"ok": False, "error": "memberIds must have >= 2 members"}

        # Ensure current agent is in the group
        if agent_id not in member_ids:
            member_ids = [agent_id] + member_ids

        try:
            if len(member_ids) == 2:
                group_id = store.merge_duplicate_exact_p2p_groups(
                    workspace_id=workspace_id,
                    member_a=member_ids[0],
                    member_b=member_ids[1],
                    preferred_name=name,
                )
                if not group_id:
                    result = store.create_group(
                        workspace_id=workspace_id,
                        member_ids=member_ids,
                        name=name,
                    )
                    group_id = result["id"]
                return {"ok": True, "groupId": group_id, "name": name}

            result = store.create_group(
                workspace_id=workspace_id,
                member_ids=member_ids,
                name=name,
            )
            return {"ok": True, "groupId": result["id"], "name": result["name"]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def send_group_message(
        group_id: str,
        content: str,
        content_type: Optional[str] = "text",
    ) -> dict:
        """Send a message to a group."""
        if not group_id or not group_id.strip():
            return {"ok": False, "error": "Missing groupId"}
        if not content or not content.strip():
            return {"ok": False, "error": "Missing content"}

        try:
            # Check access
            members = store.list_group_member_ids(group_id.strip())
            if agent_id not in members:
                return {"ok": False, "error": "Access denied"}

            result = store.send_message(
                group_id=group_id.strip(),
                sender_id=agent_id,
                content=content.strip(),
                content_type=content_type or "text",
            )
            return {"ok": True, **result}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def send_direct_message(
        to_agent_id: str,
        content: str,
        content_type: Optional[str] = "text",
    ) -> dict:
        """Send a direct message to another agent. Use agent UUID or role name."""
        if not to_agent_id or not to_agent_id.strip():
            return {"ok": False, "error": "Missing toAgentId"}
        if not content or not content.strip():
            return {"ok": False, "error": "Missing content"}

        target_id = to_agent_id.strip()

        # If not UUID format, try to resolve by role name
        import re
        uuid_pattern = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        if not re.match(uuid_pattern, target_id, re.IGNORECASE):
            try:
                agents = store.list_agents_meta(workspace_id)
                for a in agents:
                    if a["role"].lower() == target_id.lower():
                        target_id = a["id"]
                        break
                else:
                    return {"ok": False, "error": f"Agent with role '{to_agent_id}' not found"}
            except Exception as e:
                return {"ok": False, "error": f"Failed to resolve agent role: {e}"}

        try:
            delivered = store.send_direct_message(
                workspace_id=workspace_id,
                from_id=agent_id,
                to_id=target_id,
                content=content.strip(),
                content_type=content_type or "text",
            )
            return {
                "ok": True,
                "channel": delivered["channel"],
                "groupId": delivered["groupId"],
                "messageId": delivered["messageId"],
                "sendTime": delivered["sendTime"],
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def get_group_messages(group_id: str) -> dict:
        """Fetch full message history for a group."""
        if not group_id or not group_id.strip():
            return {"ok": False, "error": "Missing groupId"}

        try:
            # Check access
            members = store.list_group_member_ids(group_id.strip())
            if agent_id not in members:
                return {"ok": False, "error": "Access denied"}

            messages = store.list_messages(group_id.strip())
            return {"ok": True, "messages": messages}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @tool
    def bash(
        command: str,
        cwd: Optional[str] = None,
        timeout_ms: Optional[int] = None,
    ) -> dict:
        """Run a shell command. Returns stdout/stderr/exitCode."""
        if not command or not command.strip():
            return {"ok": False, "error": "Missing command"}

        settings = get_settings()
        workspace_root = settings.agent_workdir or str(Path.cwd())

        # Resolve cwd
        final_cwd = workspace_root
        if cwd:
            cwd_path = Path(cwd)
            if cwd_path.is_absolute():
                resolved = cwd_path
            else:
                resolved = Path(workspace_root) / cwd_path

            # Security check
            try:
                resolved = resolved.resolve()
                root_resolved = Path(workspace_root).resolve()
                if not str(resolved).startswith(str(root_resolved)):
                    return {"ok": False, "error": "cwd must be within workspace root"}
                final_cwd = str(resolved)
            except Exception:
                return {"ok": False, "error": "Invalid cwd path"}

        timeout_seconds = (timeout_ms or 120000) / 1000

        try:
            import platform
            shell = True
            if platform.system() == "Windows":
                shell_cmd = command
            else:
                shell_cmd = command

            result = subprocess.run(
                shell_cmd,
                shell=shell,
                cwd=final_cwd,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
            return {
                "ok": True,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitCode": result.returncode,
                "cwd": final_cwd,
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Command timed out", "cwd": final_cwd}
        except Exception as e:
            return {"ok": False, "error": str(e), "cwd": final_cwd}

    return [
        self_info,
        create_agent,
        list_agents,
        send_message,
        list_groups,
        list_group_members,
        create_group,
        send_group_message,
        send_direct_message,
        get_group_messages,
        bash,
    ]
