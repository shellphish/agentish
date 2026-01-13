"""
Configuration Validator for Agentish
Validates model_config.yaml structure and tests connectivity to required services.
"""

import sys
import requests
from typing import List, Tuple, Dict, Any

try:
    from config_parser import ConfigParser
except ImportError:
    from compiler.config_parser import ConfigParser


class ValidationError(Exception):
    """Raised when configuration validation fails"""
    pass


class ConfigValidator:
    """Validate configuration and test service connectivity"""
    
    def __init__(self, config_parser: ConfigParser):
        """
        Initialize validator with a config parser
        
        Args:
            config_parser: ConfigParser instance
        """
        self.parser = config_parser
        self.errors: List[str] = []
        self.warnings: List[str] = []
    
    def validate_all(self, check_connectivity: bool = True) -> bool:
        """
        Run all validation checks
        
        Args:
            check_connectivity: Whether to test HTTP connectivity to services
        
        Returns:
            True if validation passes, False otherwise
        
        Raises:
            ValidationError: If critical validation fails
        """
        self.errors = []
        self.warnings = []
        
        # Structural validation
        self._validate_structure()
        
        # Connectivity tests (optional)
        if check_connectivity:
            self._validate_connectivity()
        
        # Report results
        if self.errors:
            error_msg = "Configuration validation FAILED:\n"
            for err in self.errors:
                error_msg += f"  ❌ {err}\n"
            raise ValidationError(error_msg)
        
        return True
    
    def _validate_structure(self):
        """Validate configuration structure"""

        # Validate provider_type (REQUIRED)
        try:
            provider_type = self.parser.get_provider_type()
        except ValueError as e:
            self.errors.append(f"Provider type error: {e}")
            provider_type = None

        # Validate provider-specific config based on provider_type
        if provider_type:
            try:
                if provider_type == 'llamacpp':
                    self.parser.get_llamacpp_config()
                elif provider_type == 'litellm':
                    self.parser.get_litellm_config()
                elif provider_type == 'openai':
                    self.parser.get_openai_config()
            except ValueError as e:
                self.errors.append(f"{provider_type.capitalize()} config error: {e}")

        # Validate Langfuse (REQUIRED)
        try:
            self.parser.get_langfuse_config()
        except ValueError as e:
            self.errors.append(f"Langfuse config error: {e}")
        
        # Validate MCP servers (OPTIONAL)
        try:
            mcp_servers = self.parser.get_mcp_servers()
            
            for idx, server in enumerate(mcp_servers):
                server_name = server.get('name', f'server_{idx}')
                
                # Required fields
                if not server.get('name'):
                    self.errors.append(f"MCP server [{idx}]: missing 'name' field")
                
                if not server.get('port'):
                    self.errors.append(f"MCP server '{server_name}': missing 'port' field")
                
                if not server.get('internal_host'):
                    # Default to name if not specified
                    if server.get('name'):
                        self.warnings.append(
                            f"MCP server '{server_name}': 'internal_host' not specified, "
                            f"defaulting to '{server_name}'"
                        )
                
                # Validate routes
                routes = server.get('routes', [])
                if not routes:
                    self.warnings.append(f"MCP server '{server_name}': no routes defined")
                elif not isinstance(routes, list):
                    self.errors.append(f"MCP server '{server_name}': routes must be a list")
                else:
                    for route_idx, route in enumerate(routes):
                        if not isinstance(route, dict):
                            self.errors.append(
                                f"MCP server '{server_name}' route[{route_idx}]: must be a dictionary"
                            )
                            continue
                        
                        if not route.get('function'):
                            self.errors.append(
                                f"MCP server '{server_name}' route[{route_idx}]: missing 'function'"
                            )
                        
                        if not route.get('endpoint'):
                            self.errors.append(
                                f"MCP server '{server_name}' route[{route_idx}]: missing 'endpoint'"
                            )
                        
                        if not route.get('method'):
                            self.warnings.append(
                                f"MCP server '{server_name}' route[{route_idx}] "
                                f"({route.get('function', 'unknown')}): 'method' not specified, defaulting to GET"
                            )
        
        except ValueError as e:
            self.errors.append(f"MCP config error: {e}")
    
    def _validate_connectivity(self):
        """Test connectivity to required services"""

        # Test provider-specific connectivity based on provider_type
        try:
            provider_type = self.parser.get_provider_type()

            if provider_type == 'llamacpp':
                llamacpp = self.parser.get_llamacpp_config()
                endpoint = llamacpp['endpoint']

                # Try common health endpoints for llamacpp
                endpoints_to_try = [
                    f"{endpoint}/health",
                    f"{endpoint}/v1/models",
                    f"{endpoint}",
                ]

                success = False
                for test_endpoint in endpoints_to_try:
                    success, msg = self._check_http_endpoint(test_endpoint, "LlamaCpp", timeout=5)
                    if success:
                        break

                if not success:
                    self.errors.append(f"LlamaCpp not accessible at {endpoint}")

            elif provider_type == 'litellm':
                litellm = self.parser.get_litellm_config()
                endpoint = litellm['endpoint']

                success, msg = self._check_http_endpoint(
                    f"{endpoint}/health",
                    "LiteLLM",
                    timeout=5
                )

                if not success:
                    # Try alternate health endpoints
                    success_alt, msg_alt = self._check_http_endpoint(
                        f"{endpoint}/v1/models",
                        "LiteLLM",
                        timeout=5
                    )
                    if not success_alt:
                        self.errors.append(msg)

            elif provider_type == 'openai':
                # OpenAI connectivity validation is optional
                # We'll just validate that the config is present
                self.parser.get_openai_config()

        except ValueError:
            pass  # Already caught in structural validation
        
        # Test Langfuse
        try:
            langfuse = self.parser.get_langfuse_config()
            host = langfuse['host']
            
            # Try multiple possible health endpoints
            endpoints_to_try = [
                f"{host}/api/public/health",
                f"{host}/health",
                f"{host}/",
            ]
            
            success = False
            last_msg = ""
            
            for endpoint in endpoints_to_try:
                success, msg = self._check_http_endpoint(endpoint, "Langfuse", timeout=5)
                last_msg = msg
                if success:
                    break
            
            if not success:
                self.errors.append(f"Langfuse not accessible at {host} (tried multiple endpoints)")
        
        except ValueError:
            pass  # Already caught in structural validation
    
    def _check_http_endpoint(
        self,
        url: str,
        service_name: str,
        timeout: int = 5
    ) -> Tuple[bool, str]:
        """
        Test HTTP endpoint connectivity
        
        Args:
            url: URL to test
            service_name: Human-readable service name
            timeout: Request timeout in seconds
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            response = requests.get(url, timeout=timeout)
            
            # Accept any non-5xx response (including 404, 401, etc.)
            # as it means the service is reachable
            if response.status_code < 500:
                return True, f"✅ {service_name} accessible at {url}"
            else:
                return False, f"❌ {service_name} returned error {response.status_code}"
        
        except requests.exceptions.Timeout:
            return False, f"❌ {service_name} timeout at {url}"
        
        except requests.exceptions.ConnectionError:
            return False, f"❌ Cannot connect to {service_name} at {url}"
        
        except Exception as e:
            return False, f"❌ {service_name} error: {str(e)}"
    
    def get_validation_report(self) -> Dict[str, Any]:
        """
        Get detailed validation report
        
        Returns:
            Dictionary with validation results
        """
        return {
            'valid': len(self.errors) == 0,
            'errors': self.errors,
            'warnings': self.warnings,
            'mcp_servers_configured': self.parser.has_mcp_servers(),
            'mcp_server_count': len(self.parser.get_mcp_servers())
        }
    
    def print_report(self):
        """Print validation report to stdout"""
        if self.errors:
            print("❌ Configuration validation FAILED:")
            for err in self.errors:
                print(f"   {err}")
        else:
            print("✅ Configuration validation PASSED")
        
        if self.warnings:
            print("\n⚠️  Warnings:")
            for warn in self.warnings:
                print(f"   {warn}")


def validate_config_file(config_path: str, check_connectivity: bool = True) -> bool:
    """
    Convenience function to validate a configuration file
    
    Args:
        config_path: Path to model_config.yaml
        check_connectivity: Whether to test HTTP connectivity
    
    Returns:
        True if validation passes
    
    Raises:
        ValidationError: If validation fails
    """
    parser = ConfigParser(config_path)
    validator = ConfigValidator(parser)
    return validator.validate_all(check_connectivity=check_connectivity)


if __name__ == '__main__':
    """Command-line validation utility"""
    import sys
    
    config_path = sys.argv[1] if len(sys.argv) > 1 else 'model_config.yaml'
    check_connectivity = '--no-connectivity' not in sys.argv
    
    try:
        parser = ConfigParser(config_path)
        validator = ConfigValidator(parser)
        
        print(f"Validating configuration: {config_path}")
        print("=" * 60)
        
        validator.validate_all(check_connectivity=check_connectivity)
        validator.print_report()
        
        print("\n✅ All validation checks passed!")
        sys.exit(0)
    
    except ValidationError as e:
        print(str(e))
        sys.exit(1)
    
    except Exception as e:
        print(f"❌ Validation error: {e}")
        sys.exit(1)
