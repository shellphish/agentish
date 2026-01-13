"""
MCP Manager for Multi-Server Support
Manages multiple MCP servers and aggregates tool definitions.
"""

import sys
import os
import logging
import requests
from typing import List, Dict, Any, Optional

# Add compiler to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'compiler'))

try:
    from compiler.config_parser import ConfigParser
except ImportError:
    from config_parser import ConfigParser

logger = logging.getLogger(__name__)


class MCPManager:
    """Manage multiple MCP servers and aggregate tool definitions"""
    
    def __init__(self, config_parser: ConfigParser):
        """
        Initialize MCP manager
        
        Args:
            config_parser: ConfigParser instance with loaded configuration
        """
        self.config_parser = config_parser
        self.servers = config_parser.get_mcp_servers()
        logger.info(f"Initialized MCPManager with {len(self.servers)} server(s)")
    
    def has_servers(self) -> bool:
        """Check if any MCP servers are configured"""
        return len(self.servers) > 0
    
    def get_server_base_url(self, server_config: Dict[str, Any]) -> str:
        """
        Get internal base URL for an MCP server
        
        Args:
            server_config: Server configuration dictionary
        
        Returns:
            Base URL string (e.g., "http://mcp_binary:8002")
        """
        internal_host = server_config.get('internal_host', server_config.get('name', 'localhost'))
        port = server_config.get('port', 8002)
        return f"http://{internal_host}:{port}"
    
    def build_tool_payload(self, server_config: Dict[str, Any], route_config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build MCP tool definition from server and route configuration
        
        Args:
            server_config: Server configuration dictionary
            route_config: Route configuration dictionary
        
        Returns:
            Tool definition dictionary
        """
        server_name = server_config.get('name', 'unknown')
        function_name = route_config.get('function', 'unknown')
        endpoint = route_config.get('endpoint', f'/mcp/{function_name}')
        method = route_config.get('method', 'GET').upper()
        
        base_url = self.get_server_base_url(server_config)
        
        return {
            "name": function_name,
            "type": "mcp",
            "description": route_config.get('description', f"MCP tool '{function_name}' from {server_name}"),
            "arguments": route_config.get('arguments', []),
            "return_schema": route_config.get('return_schema', {"success": "bool"}),
            "mcp_server": base_url,
            "mcp_method": f"{method} {endpoint}",
            "metadata": {
                "server_name": server_name,
                "endpoint": endpoint,
                "method": method
            }
        }
    
    def get_all_tools(self) -> List[Dict[str, Any]]:
        """
        Aggregate tool definitions from all enabled MCP servers
        
        Returns:
            List of tool definition dictionaries
        """
        all_tools = []
        
        for server in self.servers:
            server_name = server.get('name', 'unknown')
            routes = server.get('routes', [])
            
            logger.info(f"Loading {len(routes)} tool(s) from MCP server '{server_name}'")
            
            for route in routes:
                try:
                    tool = self.build_tool_payload(server, route)
                    all_tools.append(tool)
                except Exception as e:
                    logger.error(f"Error building tool for {server_name}/{route.get('function')}: {e}")
        
        return all_tools
    
    def health_check(self) -> Dict[str, Dict[str, Any]]:
        """
        Check health of all MCP servers
        
        Returns:
            Dictionary mapping server names to health status
            Format: {
                "server_name": {
                    "status": "healthy" | "error",
                    "error": "error message" (if status is error),
                    "tools_count": int (if status is healthy)
                }
            }
        """
        health_status = {}
        
        for server in self.servers:
            server_name = server.get('name', 'unknown')
            base_url = self.get_server_base_url(server)
            
            try:
                # Try to query the MCP server's status endpoint
                response = requests.get(f"{base_url}/mcp/status", timeout=5)
                
                if response.status_code == 200:
                    data = response.json()
                    health_status[server_name] = {
                        "status": "healthy",
                        "tools_count": len(server.get('routes', [])),
                        "response": data
                    }
                else:
                    health_status[server_name] = {
                        "status": "error",
                        "error": f"HTTP {response.status_code}"
                    }
            
            except requests.exceptions.ConnectionError:
                health_status[server_name] = {
                    "status": "error",
                    "error": f"Cannot connect to {base_url}"
                }
            
            except requests.exceptions.Timeout:
                health_status[server_name] = {
                    "status": "error",
                    "error": "Connection timeout"
                }
            
            except Exception as e:
                health_status[server_name] = {
                    "status": "error",
                    "error": str(e)
                }
        
        return health_status
    
    def get_tools_with_health(self) -> Dict[str, Any]:
        """
        Get all tools along with server health status
        
        Returns:
            Dictionary with tools and server_status
            Format: {
                "tools": [...],
                "server_status": {
                    "server_name": {...}
                }
            }
        """
        tools = self.get_all_tools()
        health = self.health_check()
        
        return {
            "tools": tools,
            "server_status": health
        }
    
    def get_server_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Get server configuration by name
        
        Args:
            name: Server name
        
        Returns:
            Server configuration or None
        """
        for server in self.servers:
            if server.get('name') == name:
                return server
        return None
