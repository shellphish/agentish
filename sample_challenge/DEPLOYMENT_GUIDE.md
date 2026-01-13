# Agentish Binary Challenge - Deployment Guide

This guide covers deploying the Agentish binary analysis challenge with the new dual-configuration system.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Configuration Files](#configuration-files)
- [Quick Start](#quick-start)
- [Provider-Specific Setup](#provider-specific-setup)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Services

1. **LLM Provider** (choose one):
   - **LlamaCpp server** with OpenAI-compatible API
   - **LiteLLM gateway**
   - **OpenAI API** access

2. **Langfuse instance** for observability

3. **Docker & Docker Compose** (for containerized deployment)

---

## Configuration Files

Agentish uses **two separate configuration files**:

### 1. model_config.yaml - LLM Provider Configuration

```yaml
# Provider Type (REQUIRED) - Choose one: llamacpp, litellm, openai
provider_type: "llamacpp"

# Model settings
model: "Qwen3-14B-Q8_0"
temperature: 0.0
recursion_limit: 500

# LlamaCpp Configuration (when provider_type="llamacpp")
llamacpp:
  endpoint: "http://your-llamacpp:4000/v1"
  api_key: "your_api_key"

# LiteLLM Configuration (when provider_type="litellm")
litellm:
  endpoint: "http://your-litellm:4000"
  api_key: "your_api_key"

# OpenAI Configuration (when provider_type="openai")
openai:
  api_key: "sk-..."
  endpoint: ""  # Optional

# Langfuse (REQUIRED)
langfuse:
  host: "http://your-langfuse:3000"
  public_key: "pk-lf-..."
  secret_key: "sk-lf-..."
```

### 2. mcp_config.yaml - MCP Server Configuration

```yaml
mcp_servers:
  - name: "binary_analysis"
    port: 8002
    internal_host: "mcp_binary"
    enabled: true
    routes:
      - function: "list_functions"
        endpoint: "/mcp/list_functions"
        method: "GET"
```

---

## Quick Start

### Step 1: Edit Configuration

```bash
cd sample_challenge

# Edit model_config.yaml with your LLM provider settings
nano model_config.yaml

# Set provider_type and fill in the corresponding section
# Example for llamacpp:
#   provider_type: "llamacpp"
#   llamacpp:
#     endpoint: "http://128.111.49.59:4000/v1"
#     api_key: "local_llm_is_da_best"
```

### Step 2: Validate Configuration

```bash
python3 ../compiler/config_validator.py model_config.yaml
```

Expected output:
```
✅ Configuration loaded successfully
✅ Configuration validation PASSED
```

### Step 3: Deploy

```bash
./run_local.sh
```

This will:
- Validate both config files
- Build Docker images
- Start agentish and mcp_binary services
- Expose UI at http://localhost:8000

---

## Provider-Specific Setup

### Option 1: LlamaCpp

**Use Case**: Local or remote LlamaCpp server with OpenAI-compatible API

**Configuration:**
```yaml
provider_type: "llamacpp"
model: "Qwen3-14B-Q8_0"

llamacpp:
  endpoint: "http://your-llamacpp-server:4000/v1"
  api_key: "local_key"
```

**Test Connectivity:**
```bash
curl http://your-llamacpp-server:4000/v1/models
```

### Option 2: LiteLLM

**Use Case**: LiteLLM gateway to multiple LLM providers

**Configuration:**
```yaml
provider_type: "litellm"
model: "gpt-4"  # Use exact LiteLLM model name

litellm:
  endpoint: "http://your-litellm:4000"
  api_key: "your_litellm_key"
```

**Test Connectivity:**
```bash
curl http://your-litellm:4000/health
```

### Option 3: OpenAI

**Use Case**: Official OpenAI API or Azure OpenAI

**Configuration:**
```yaml
provider_type: "openai"
model: "gpt-4"

openai:
  api_key: "sk-..."
  endpoint: ""  # Leave empty for official OpenAI
```

**For Azure OpenAI:**
```yaml
provider_type: "openai"
model: "your-deployment-name"

openai:
  api_key: "your_azure_key"
  endpoint: "https://your-resource.openai.azure.com/"
```

---

## Testing

### 1. Configuration Validation

```bash
# Structure validation only
python3 ../compiler/config_validator.py model_config.yaml --no-connectivity

# With connectivity checks
python3 ../compiler/config_validator.py model_config.yaml
```

### 2. Backend Startup

```bash
cd backend
python3 server.py --port 8000
```

Expected:
```
✅ Configuration loaded successfully
✅ MCP Manager initialized with 1 server(s)
📊 Frontend available at: http://localhost:8000
```

### 3. MCP Tools

```bash
curl http://localhost:8000/api/mcp/tools | jq
```

Expected: List of binary analysis tools

### 4. Full Deployment

```bash
cd sample_challenge
docker-compose up -d
docker-compose logs -f
```

Access UI at http://localhost:8000

---

## Troubleshooting

### Configuration Errors

**"provider_type is required"**
```bash
# Add to model_config.yaml:
provider_type: "llamacpp"  # or "litellm" or "openai"
```

**"llamacpp.endpoint is required"**
```bash
# Complete the active provider section:
llamacpp:
  endpoint: "http://your-server:4000/v1"
  api_key: "your_key"
```

### Connectivity Issues

**Provider Not Accessible**
```bash
# Test direct connection
curl http://your-provider:4000/health

# From Docker container
docker exec agentish_ui curl http://your-provider:4000/health
```

**MCP Server Not Found**
```bash
# Check container status
docker ps | grep mcp_binary

# Test internal connection
docker exec agentish_ui curl http://mcp_binary:8002/health
```

### Docker Issues

**Containers Won't Start**
```bash
# Check logs
docker-compose logs agentish
docker-compose logs mcp_binary

# Rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## Architecture

```
┌─────────────────────────────────────┐
│     Agentish (Port 8000)            │
│  ┌───────────────────────────────┐  │
│  │  Frontend (Visual Editor)      │  │
│  │  - Node-based workflow UI      │  │
│  │  - ASL export                  │  │
│  └───────────────────────────────┘  │
│                ↓                     │
│  ┌───────────────────────────────┐  │
│  │  Backend (Flask API)           │  │
│  │  - Load model_config.yaml      │  │
│  │  - Load mcp_config.yaml        │  │
│  │  - Compile ASL to Python       │  │
│  └───────────────────────────────┘  │
│                ↓                     │
│  ┌───────────────────────────────┐  │
│  │  Compiler (Code Generator)     │  │
│  │  - Inject provider config      │  │
│  │  - Generate LangGraph code     │  │
│  └───────────────────────────────┘  │
└─────────────────┬───────────────────┘
                  │ Internal Network
                  ↓
     ┌────────────────────────┐
     │  MCP Server (Port 8002) │
     │  - Binary Analysis Tools │
     │  - Call Graph            │
     │  - Disassembly           │
     └────────────────────────┘
```

---

## Key Files

- **model_config.yaml** - LLM provider settings
- **mcp_config.yaml** - MCP server definitions
- **docker-compose.yml** - Service orchestration
- **run_local.sh** - Deployment script

## Quick Commands

```bash
# Validate config
python3 ../compiler/config_validator.py model_config.yaml

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild
docker-compose build --no-cache
```

---

For more details, see:
- [README.md](README.md) - Challenge overview
- [MCP_SERVER_GUIDE.md](MCP_SERVER_GUIDE.md) - MCP server development
