"""
Configuration Parser for Agentish
Loads and parses model_config.yaml and mcp_config.yaml to extract runtime configuration.
"""

import os
import yaml
from pathlib import Path
from typing import Dict, List, Any, Optional


class ConfigParser:
    """Parse and provide access to model_config.yaml and mcp_config.yaml settings"""

    def __init__(self, config_path: Optional[str] = None, mcp_config_path: Optional[str] = None):
        """
        Initialize config parser

        Args:
            config_path: Path to model_config.yaml. If None, uses MODEL_CONFIG_PATH env var
            mcp_config_path: Path to mcp_config.yaml. If None, looks in same directory as model_config.yaml
        """
        if config_path is None:
            config_path = os.environ.get("MODEL_CONFIG_PATH", "model_config.yaml")

        self.config_path = config_path
        self.config = self._load_config(self.config_path)

        # Determine MCP config path
        if mcp_config_path is None:
            # Look for mcp_config.yaml in same directory as model_config.yaml
            config_dir = Path(config_path).parent
            mcp_config_path = config_dir / "mcp_config.yaml"

        self.mcp_config_path = str(mcp_config_path)
        self.mcp_config = self._load_mcp_config()
    
    def _load_config(self, path: str) -> Dict[str, Any]:
        """Load YAML configuration file"""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
                return config if config else {}
        except FileNotFoundError:
            raise FileNotFoundError(f"Configuration file not found: {path}")
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML in configuration file: {e}")

    def _load_mcp_config(self) -> Dict[str, Any]:
        """Load MCP configuration file (optional)"""
        try:
            if os.path.exists(self.mcp_config_path):
                with open(self.mcp_config_path, 'r', encoding='utf-8') as f:
                    config = yaml.safe_load(f)
                    return config if config else {}
            else:
                # MCP config is optional
                return {}
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML in MCP configuration file: {e}")
    
    def get_provider_type(self) -> str:
        """
        Get LLM provider type

        Returns:
            Provider type: 'llamacpp', 'litellm', or 'openai'

        Raises:
            ValueError: If provider_type is not specified or invalid
        """
        provider_type = self.config.get('provider_type', '')

        if not provider_type:
            raise ValueError("provider_type is required but not specified in model_config.yaml")

        valid_types = ['llamacpp', 'litellm', 'openai']
        if provider_type not in valid_types:
            raise ValueError(f"Invalid provider_type '{provider_type}'. Must be one of: {', '.join(valid_types)}")

        return provider_type

    def get_provider_config(self) -> Dict[str, Any]:
        """
        Get LLM provider configuration

        Returns:
            Dict with provider, model, temperature, recursion_limit, use_tracing, provider_type
        """
        return {
            'provider': self.config.get('provider', 'openai'),
            'model': self.config.get('model', 'gpt-4'),
            'temperature': self.config.get('temperature', 0.0),
            'recursion_limit': self.config.get('recursion_limit', 300),
            'use_tracing': self.config.get('use_tracing', True),
            'provider_type': self.get_provider_type(),
        }
    
    def get_llamacpp_config(self) -> Dict[str, str]:
        """
        Get LlamaCpp configuration

        Returns:
            Dict with endpoint and api_key

        Raises:
            ValueError: If required fields are missing
        """
        llamacpp = self.config.get('llamacpp', {})

        if not isinstance(llamacpp, dict):
            raise ValueError("llamacpp configuration must be a dictionary")

        endpoint = llamacpp.get('endpoint', '')
        api_key = llamacpp.get('api_key', '')

        if not endpoint:
            raise ValueError("llamacpp.endpoint is required but not configured")
        if not api_key:
            raise ValueError("llamacpp.api_key is required but not configured")

        return {
            'endpoint': endpoint.rstrip('/'),
            'api_key': api_key
        }

    def get_litellm_config(self) -> Dict[str, str]:
        """
        Get LiteLLM configuration

        Returns:
            Dict with endpoint and api_key

        Raises:
            ValueError: If required fields are missing
        """
        litellm = self.config.get('litellm', {})

        if not isinstance(litellm, dict):
            raise ValueError("litellm configuration must be a dictionary")

        endpoint = litellm.get('endpoint', '')
        api_key = litellm.get('api_key', '')

        if not endpoint:
            raise ValueError("litellm.endpoint is required but not configured")
        if not api_key:
            raise ValueError("litellm.api_key is required but not configured")

        return {
            'endpoint': endpoint.rstrip('/'),
            'api_key': api_key
        }

    def get_openai_config(self) -> Dict[str, str]:
        """
        Get OpenAI configuration

        Returns:
            Dict with api_key and optional endpoint

        Raises:
            ValueError: If required fields are missing
        """
        openai = self.config.get('openai', {})

        if not isinstance(openai, dict):
            raise ValueError("openai configuration must be a dictionary")

        api_key = openai.get('api_key', '')
        endpoint = openai.get('endpoint', '')

        if not api_key:
            raise ValueError("openai.api_key is required but not configured")

        result = {'api_key': api_key}
        if endpoint:
            result['endpoint'] = endpoint.rstrip('/')

        return result
    
    def get_langfuse_config(self) -> Dict[str, str]:
        """
        Get Langfuse configuration
        
        Returns:
            Dict with host, public_key, secret_key
        
        Raises:
            ValueError: If required fields are missing
        """
        langfuse = self.config.get('langfuse', {})
        
        if not isinstance(langfuse, dict):
            raise ValueError("langfuse configuration must be a dictionary")
        
        host = langfuse.get('host', '')
        public_key = langfuse.get('public_key', '')
        secret_key = langfuse.get('secret_key', '')
        
        if not host:
            raise ValueError("langfuse.host is required but not configured")
        if not public_key:
            raise ValueError("langfuse.public_key is required but not configured")
        if not secret_key:
            raise ValueError("langfuse.secret_key is required but not configured")
        
        return {
            'host': host.rstrip('/'),
            'public_key': public_key,
            'secret_key': secret_key
        }
    
    def get_mcp_servers(self) -> List[Dict[str, Any]]:
        """
        Get MCP server configurations from mcp_config.yaml

        Returns:
            List of enabled MCP server configurations with routes.
            Returns empty list if mcp_servers section is missing or empty.
        """
        mcp_servers = self.mcp_config.get('mcp_servers', [])

        # Handle missing or None
        if not mcp_servers:
            return []

        # Validate it's a list
        if not isinstance(mcp_servers, list):
            raise ValueError("mcp_servers must be a list in mcp_config.yaml")

        # Filter and return only enabled servers
        enabled_servers = []
        for server in mcp_servers:
            if not isinstance(server, dict):
                continue

            # Check if server is enabled (default to True if not specified)
            if server.get('enabled', True):
                enabled_servers.append(server)

        return enabled_servers
    
    def get_mcp_server_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Get a specific MCP server configuration by name
        
        Args:
            name: Name of the MCP server
        
        Returns:
            Server configuration dict or None if not found
        """
        for server in self.get_mcp_servers():
            if server.get('name') == name:
                return server
        return None
    
    def get_all_env_vars(self) -> Dict[str, str]:
        """
        Generate all environment variables for runtime

        Returns:
            Dictionary of environment variables
        """
        env_vars = {}

        # Provider configuration
        provider = self.get_provider_config()
        provider_type = provider['provider_type']

        env_vars['PROVIDER_TYPE'] = provider_type
        env_vars['LLM_MODEL_NAME'] = provider['model']
        env_vars['LLM_TEMPERATURE'] = str(provider['temperature'])
        env_vars['RECURSION_LIMIT'] = str(provider['recursion_limit'])
        env_vars['USE_TRACING'] = str(provider['use_tracing']).lower()

        # Provider-specific configuration
        try:
            if provider_type == 'llamacpp':
                llamacpp = self.get_llamacpp_config()
                env_vars['LLAMACPP_ENDPOINT'] = llamacpp['endpoint']
                env_vars['LLAMACPP_API_KEY'] = llamacpp['api_key']
            elif provider_type == 'litellm':
                litellm = self.get_litellm_config()
                env_vars['LITELLM_ENDPOINT'] = litellm['endpoint']
                env_vars['LITELLM_API_KEY'] = litellm['api_key']
            elif provider_type == 'openai':
                openai = self.get_openai_config()
                env_vars['OPENAI_API_KEY'] = openai['api_key']
                if 'endpoint' in openai:
                    env_vars['OPENAI_ENDPOINT'] = openai['endpoint']
        except ValueError:
            pass  # Will be caught by validator

        # Langfuse configuration
        try:
            langfuse = self.get_langfuse_config()
            env_vars['LANGFUSE_HOST'] = langfuse['host']
            env_vars['LANGFUSE_PUBLIC_KEY'] = langfuse['public_key']
            env_vars['LANGFUSE_SECRET_KEY'] = langfuse['secret_key']
        except ValueError:
            pass  # Will be caught by validator

        return env_vars
    
    def get_provider_specific_config(self) -> Dict[str, Any]:
        """
        Get provider-specific configuration based on provider_type

        Returns:
            Configuration dict for the active provider (llamacpp, litellm, or openai)

        Raises:
            ValueError: If provider configuration is invalid
        """
        provider_type = self.get_provider_type()

        if provider_type == 'llamacpp':
            return self.get_llamacpp_config()
        elif provider_type == 'litellm':
            return self.get_litellm_config()
        elif provider_type == 'openai':
            return self.get_openai_config()
        else:
            raise ValueError(f"Unknown provider_type: {provider_type}")

    def has_mcp_servers(self) -> bool:
        """Check if any MCP servers are configured and enabled"""
        return len(self.get_mcp_servers()) > 0

    def __repr__(self):
        return f"ConfigParser(config_path='{self.config_path}', mcp_config_path='{self.mcp_config_path}')"
