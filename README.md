# Agentish

A visual agent builder and execution environment for creating LangGraph agents through an intuitive UI.

## Configuration

Agentish uses two YAML configuration files:

### 1. model_config.yaml - LLM Provider Configuration

Configures the language model provider and observability:

- **provider_type**: The LLM infrastructure type (`llamacpp`, `litellm`, or `openai`)
- **model**: Model name to use
- **temperature**: Model temperature (0.0 - 1.0)
- **Provider-specific settings**: Endpoint and API key for the chosen provider
- **Langfuse**: Observability and tracing configuration

### 2. mcp_config.yaml - MCP Server Configuration

Configures Model Context Protocol servers that provide tools to agents:

- **mcp_servers**: List of MCP server definitions with routes and tool descriptions

## Supported LLM Providers

### LlamaCpp
Use local or remote LlamaCpp servers with OpenAI-compatible API:
```yaml
provider_type: "llamacpp"
llamacpp:
  endpoint: "http://your-server:4000/v1"
  api_key: "your_api_key"
```

### LiteLLM
Use LiteLLM as a gateway to access different LLM providers:
```yaml
provider_type: "litellm"
litellm:
  endpoint: "http://your-litellm:4000"
  api_key: "your_api_key"
```

### OpenAI
Use OpenAI API or compatible services (Azure OpenAI, etc.):
```yaml
provider_type: "openai"
openai:
  api_key: "your_openai_key"
  endpoint: ""  # Optional: for Azure OpenAI or custom endpoints
```

## Core Dependencies

- **LLM Provider**: LlamaCpp, LiteLLM, or OpenAI (configured via provider_type)
- **LangFuse**: Observability and tracing for LLM calls 
