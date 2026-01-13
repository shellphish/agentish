#!/usr/bin/env python3
"""
Pre-flight configuration validation with connectivity tests
Validates model_config.yaml before starting services.
"""

import sys
import os

# Add compiler to path
# Support both Docker (/workspace/compiler) and local execution (../../compiler from scripts/)
script_dir = os.path.dirname(os.path.abspath(__file__))
if os.path.exists('/workspace/compiler'):
    # Running in Docker
    sys.path.insert(0, '/workspace/compiler')
else:
    # Running locally
    compiler_path = os.path.abspath(os.path.join(script_dir, '../../compiler'))
    sys.path.insert(0, compiler_path)

from config_parser import ConfigParser
from config_validator import ConfigValidator


def main():
    """Main validation routine"""
    config_path = sys.argv[1] if len(sys.argv) > 1 else 'model_config.yaml'
    check_connectivity = '--no-connectivity' not in sys.argv
    
    print(f"Validating configuration: {config_path}")
    print("=" * 60)
    
    try:
        # Load configuration
        parser = ConfigParser(config_path)
        validator = ConfigValidator(parser)
        
        # Run validation
        validator.validate_all(check_connectivity=check_connectivity)
        
        # Print report
        validator.print_report()
        
        # Additional info
        if parser.has_mcp_servers():
            print(f"\nℹ️  MCP Servers: {len(parser.get_mcp_servers())} configured")
        else:
            print("\nℹ️  MCP Servers: None configured (MCP tools will not be available)")
        
        print("\n✅ All validation checks passed!")
        sys.exit(0)
    
    except Exception as e:
        print(f"\n❌ Validation failed: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
