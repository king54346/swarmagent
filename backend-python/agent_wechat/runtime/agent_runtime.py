"""Agent Runtime - global agent manager."""

import logging
from typing import Optional

from ..storage.store import store
from .event_bus import AgentEventBus, get_agent_event_bus
from .agent_runner import AgentRunner

logger = logging.getLogger(__name__)


class AgentRuntime:
    """Global agent runtime manager.
    管理所有代理运行器并协调代理生命周期。
    """

    VERSION = 3

    def __init__(self):
        self._runners: dict[str, AgentRunner] = {}
        self._bootstrapped = False
        self.bus = get_agent_event_bus()

    async def bootstrap(self):
        """Initialize runners for all existing agents."""
        if self._bootstrapped:
            return
        self._bootstrapped = True

        try:
            agents = store.list_agents()
            for agent in agents:
                if agent["role"] == "human":
                    continue
                self.ensure_runner(agent["id"])
            logger.info(f"Bootstrapped {len(self._runners)} agent runners")
        except Exception as e:
            logger.exception(f"Bootstrap failed: {e}")

    def ensure_runner(self, agent_id: str) -> AgentRunner:
        """确保为给定的 agent_id 创建一个 AgentRunner 实例，如果已经存在则返回它。"""
        existing = self._runners.get(agent_id)
        if existing:
            return existing
        # 创建新的 AgentRunner 实例并启动
        runner = AgentRunner(
            agent_id=agent_id,
            ensure_runner=self.ensure_runner,
            wake_agent=lambda aid: self.ensure_runner(aid).wakeup("manual"),
        )
        self._runners[agent_id] = runner
        runner.start()
        return runner
    # 1. 获取群组所有成员 member_ids
    # 2. 遍历成员，跳过 sender 和 human
    # 3. 对每个 AI Agent 调用 ensure_runner().wakeup()
    async def wake_agents_for_group(self, group_id: str, sender_id: str):
        """唤醒群组内所有非human的Agent（除了发送者）"""
        await self.bootstrap()

        try:
            member_ids = store.list_group_member_ids(group_id)
        except Exception:
            return

        for member_id in member_ids:
            if member_id == sender_id:
                continue

            try:
                agent = store.get_agent(member_id)
                if agent["role"] == "human":
                    continue
                self.ensure_runner(member_id).wakeup("group_message")
            except Exception:
                continue

    async def wake_agent(
        self,
        agent_id: str,
        reason: str = "direct_message",
    ):
        """Wake a specific agent."""
        await self.bootstrap()

        try:
            agent = store.get_agent(agent_id)
            if agent["role"] == "human":
                return
            self.ensure_runner(agent_id).wakeup(reason)
        except Exception:
            pass


# Global singleton
_runtime: Optional[AgentRuntime] = None
_runtime_version: Optional[int] = None


# 获取全局的代理运行时 AgentRuntime 实例
def get_agent_runtime() -> AgentRuntime:
    """Get the global agent runtime singleton."""
    global _runtime, _runtime_version

    if _runtime and _runtime_version == AgentRuntime.VERSION:
        return _runtime

    _runtime = AgentRuntime()
    _runtime_version = AgentRuntime.VERSION
    return _runtime
