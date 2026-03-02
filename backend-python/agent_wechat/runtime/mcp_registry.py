"""MCP (Model Context Protocol) tool registry."""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_MS = int(os.getenv("MCP_TIMEOUT_MS", "30000"))


class McpToolEntry:
    """A registered MCP tool."""

    def __init__(
        self,
        exposed_name: str,
        server_name: str,
        tool_name: str,
        description: str,
        input_schema: dict,
    ):
        self.exposed_name = exposed_name
        self.server_name = server_name
        self.tool_name = tool_name
        self.description = description
        self.input_schema = input_schema


class McpRegistry:
    """Registry for MCP tools."""

    def __init__(self):
        self._loaded = False
        self._loading: Optional[asyncio.Task] = None
        self._clients: dict[str, Any] = {}
        self._tools: dict[str, McpToolEntry] = {}
        self._reserved_names: set[str] = set()

    async def ensure_loaded(
        self,
        reserved: Optional[set[str]] = None,
        load_timeout_ms: Optional[int] = None,
    ):
        """Ensure MCP tools are loaded."""
        if reserved:
            self._reserved_names.update(reserved)

        if self._loaded:
            return

        if self._loading:
            await self._loading
            return

        self._loading = asyncio.create_task(self._load())

        if load_timeout_ms and load_timeout_ms > 0:
            logger.info(f"[mcp] loading with timeout {load_timeout_ms}ms")
            try:
                await asyncio.wait_for(
                    self._loading,
                    timeout=load_timeout_ms / 1000,
                )
            except asyncio.TimeoutError:
                logger.warning("[mcp] loading timed out")
        else:
            await self._loading

    def has_tool(self, name: str) -> bool:
        """Check if a tool exists."""
        return name in self._tools

    def get_tool_definitions(self) -> list[dict]:
        """Get OpenAI-format tool definitions."""
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.exposed_name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            }
            for tool in self._tools.values()
        ]

    async def call_tool(
        self,
        name: str,
        args: dict[str, Any],
    ) -> dict:
        """Call an MCP tool."""
        entry = self._tools.get(name)
        if not entry:
            return {"ok": False, "error": f"Unknown MCP tool: {name}"}

        client = self._clients.get(entry.server_name)
        if not client:
            return {"ok": False, "error": f"MCP server not connected: {entry.server_name}"}

        try:
            result = await client.call_tool(
                name=entry.tool_name,
                arguments=args,
            )
            content, is_error = self._format_tool_output(result)
            return {
                "ok": not is_error,
                "content": content,
                "raw": result,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _format_tool_output(self, result: Any) -> tuple[str, bool]:
        """Format MCP tool output."""
        is_error = bool(getattr(result, "isError", False))

        content_items = getattr(result, "content", None)
        if isinstance(content_items, list):
            parts = []
            for item in content_items:
                if hasattr(item, "text"):
                    parts.append(item.text)
                else:
                    try:
                        parts.append(json.dumps(item))
                    except (TypeError, ValueError):
                        parts.append(str(item))
            return "\n".join(parts), is_error

        if isinstance(content_items, str):
            return content_items, is_error

        try:
            return json.dumps(result), is_error
        except (TypeError, ValueError):
            return str(result), is_error

    async def _load(self):
        """Load MCP configuration and connect to servers."""
        config_path = await self._resolve_config_path()
        if not config_path:
            logger.info("[mcp] config not found; skipping MCP load")
            self._loaded = True
            return

        logger.info(f"[mcp] loading config from {config_path}")

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            logger.warning(f"[mcp] failed to load config: {e}")
            self._loaded = True
            return

        servers = config.get("mcpServers", {})
        for name, server_config in servers.items():
            if server_config.get("disabled"):
                continue

            try:
                logger.info(f"[mcp] connecting {name}...")
                client = await self._connect_server(name, server_config)
                self._clients[name] = client

                tools = await self._list_tools(client)
                logger.info(f"[mcp] {name} tools: {len(tools)}")

                for tool in tools:
                    self._register_tool(name, tool)
            except Exception as e:
                logger.warning(f"[mcp] {name} failed: {e}")

        logger.info(f"[mcp] total tools loaded: {len(self._tools)}")
        self._loaded = True

    async def _resolve_config_path(self) -> Optional[str]:
        """Find the MCP config file."""
        env_path = os.getenv("MCP_CONFIG_PATH")
        if env_path:
            path = Path(env_path).resolve()
            if path.exists():
                return str(path)
            return None

        cwd = Path.cwd()
        candidates = [
            cwd / "mcp.json",
            cwd / "backend-python" / "mcp.json",
            cwd / ".mcp.json",
            cwd / "backend-python" / ".mcp.json",
        ]

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        return None

    async def _connect_server(self, name: str, config: dict) -> Any:
        """Connect to an MCP server."""
        try:
            from mcp import Client
            from mcp.client.stdio import StdioClientParameters, stdio_client
        except ImportError:
            logger.warning("[mcp] mcp package not installed")
            raise ImportError("mcp package required for MCP support")

        timeout = config.get("timeoutMs", DEFAULT_TIMEOUT_MS)

        # Stdio transport
        if config.get("command") or config.get("type") == "stdio":
            command = config.get("command")
            if not command:
                raise ValueError(f"Missing MCP command for server: {name}")

            args = config.get("args", [])
            env = {**os.environ, **config.get("env", {})}

            params = StdioClientParameters(
                command=command,
                args=args,
                env=env,
            )

            async with stdio_client(params) as (read, write):
                async with Client(name, "0.0.1") as client:
                    await client.connect(read, write)
                    return client

        # HTTP/SSE transport (simplified - full implementation would need more)
        url = config.get("httpUrl") or config.get("sseUrl") or config.get("url")
        if not url:
            raise ValueError(f"Missing MCP url for server: {name}")

        # For now, return a placeholder - full HTTP/SSE support would need more work
        logger.warning(f"[mcp] HTTP/SSE transport not fully implemented for {name}")
        raise NotImplementedError("HTTP/SSE MCP transport not yet implemented")

    async def _list_tools(self, client: Any) -> list[dict]:
        """List tools from an MCP client."""
        try:
            response = await client.list_tools()
            return response.tools if hasattr(response, "tools") else []
        except Exception:
            return []

    def _register_tool(self, server_name: str, tool: Any):
        """Register a tool from an MCP server."""
        base_name = tool.name if hasattr(tool, "name") else tool.get("name", "")
        description = (
            tool.description
            if hasattr(tool, "description")
            else tool.get("description", "")
        )
        input_schema = (
            tool.inputSchema
            if hasattr(tool, "inputSchema")
            else tool.get("inputSchema", {"type": "object", "properties": {}})
        )

        exposed_name = base_name

        # Handle name collisions
        if exposed_name in self._reserved_names or exposed_name in self._tools:
            next_name = f"mcp.{server_name}.{base_name}"
            counter = 2
            while next_name in self._reserved_names or next_name in self._tools:
                next_name = f"mcp.{server_name}.{base_name}.{counter}"
                counter += 1
            exposed_name = next_name

        self._tools[exposed_name] = McpToolEntry(
            exposed_name=exposed_name,
            server_name=server_name,
            tool_name=base_name,
            description=description or f"[mcp:{server_name}] {base_name}",
            input_schema=input_schema,
        )


# Global singleton
_registry: Optional[McpRegistry] = None


async def get_mcp_registry(
    reserved: Optional[set[str]] = None,
    load_timeout_ms: Optional[int] = None,
) -> McpRegistry:
    """Get the global MCP registry."""
    global _registry

    if _registry is None:
        _registry = McpRegistry()

    await _registry.ensure_loaded(reserved, load_timeout_ms)
    return _registry
