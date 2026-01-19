import json
import os
import operator
import uuid
from typing import Any, Dict, List, Tuple, TypedDict, Optional, Annotated, Literal
import requests
import yaml

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_ollama import ChatOllama
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command
from langfuse.langchain import CallbackHandler
load_dotenv()

#{ Template for helper utility functions #}
# ==========================================
# HELPER FUNCTIONS
# ==========================================

class _SafeFormat(dict):
    """Safe string formatter that returns placeholders for missing keys."""
    def __missing__(self, key):
        return "{" + key + "}"


def render_template(template: str, state: dict) -> str:
    """Render a template string with state variables."""
    if not template:
        return ""
    try:
        format_map = _SafeFormat({**state, "state": state})
        return template.format_map(format_map)
    except Exception:
        return template


def _generate_session_id() -> str:
    """Generate a unique session ID for langfuse tracing."""
    return uuid.uuid4().hex


# ==========================================
# MODEL INITIALIZATION AND LANGFUSE SETUP
# ==========================================

def _load_env_config():
    """Load environment configuration for LLM and Langfuse from model_config.yaml or environment variables."""
    import os

    # Try to load from model_config.yaml if MODEL_CONFIG_PATH is set
    config_path = os.getenv("MODEL_CONFIG_PATH")
    if config_path and os.path.exists(config_path):
        try:
            import yaml
            with open(config_path, 'r') as f:
                yaml_config = yaml.safe_load(f)

            # Extract provider configuration from top-level keys
            provider_type = yaml_config.get('provider_type', 'openai')

            # Extract provider-specific config
            result = {
                "provider_type": provider_type,
                "llm_model_name": yaml_config.get('model', 'gpt-4'),
                "llm_temperature": float(yaml_config.get('temperature', 0.0)),
                "llm_context_window": int(yaml_config.get('context_window', 8192)),
                "llm_max_output_tokens": int(yaml_config.get('max_output_tokens', 4096)),
            }

            # Provider-specific settings
            if provider_type == 'llamacpp':
                llamacpp = yaml_config.get('llamacpp', {}) or {}
                result["llamacpp_endpoint"] = llamacpp.get('endpoint', '')
                result["llamacpp_api_key"] = llamacpp.get('api_key', '')
            elif provider_type == 'litellm':
                litellm = yaml_config.get('litellm', {}) or {}
                result["litellm_endpoint"] = litellm.get('endpoint', '')
                result["litellm_api_key"] = litellm.get('api_key', '')
            elif provider_type == 'openai':
                openai_config = yaml_config.get('openai', {}) or {}
                result["openai_api_key"] = openai_config.get('api_key', '')
                result["openai_endpoint"] = openai_config.get('endpoint', '')

            # Langfuse configuration
            langfuse = yaml_config.get('langfuse', {}) or {}
            result["langfuse_public_key"] = langfuse.get('public_key', '')
            result["langfuse_secret_key"] = langfuse.get('secret_key', '')
            result["langfuse_host"] = langfuse.get('host', 'https://cloud.langfuse.com')

            # Check if tracing is enabled
            result["enable_tracing"] = yaml_config.get('enable_tracing', False)

            return result
        except Exception as e:
            print(f"Warning: Failed to load config from {config_path}: {e}")
            print("Falling back to environment variables")

    # Fallback to environment variables
    return {
        "provider_type": os.getenv("PROVIDER_TYPE", "openai"),
        "llm_model_name": os.getenv("LLM_MODEL_NAME", "gpt-4"),
        "llm_temperature": float(os.getenv("LLM_TEMPERATURE", "0.0")),
        "llm_context_window": int(os.getenv("LLM_CONTEXT_WINDOW", "8192")),
        "llm_max_output_tokens": int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "4096")),

        # Provider-specific settings
        "llamacpp_endpoint": os.getenv("LLAMACPP_ENDPOINT", ""),
        "llamacpp_api_key": os.getenv("LLAMACPP_API_KEY", ""),
        "litellm_endpoint": os.getenv("LITELLM_ENDPOINT", ""),
        "litellm_api_key": os.getenv("LITELLM_API_KEY", ""),
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "openai_endpoint": os.getenv("OPENAI_ENDPOINT", ""),

        # Langfuse configuration
        "langfuse_public_key": os.getenv("LANGFUSE_PUBLIC_KEY", ""),
        "langfuse_secret_key": os.getenv("LANGFUSE_SECRET_KEY", ""),
        "langfuse_host": os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),

        # Tracing flag
        "enable_tracing": os.getenv("ENABLE_TRACING", "false").lower() == "true",
    }

ENV_CONFIG = _load_env_config()


def _create_langfuse_handler():
    """Create Langfuse callback handler if configured and enabled."""
    # Check if tracing is enabled
    if not ENV_CONFIG.get("enable_tracing", False):
        return None

    if not ENV_CONFIG.get("langfuse_public_key") or not ENV_CONFIG.get("langfuse_secret_key"):
        return None

    try:
        import os
        os.environ["LANGFUSE_PUBLIC_KEY"] = ENV_CONFIG["langfuse_public_key"]
        os.environ["LANGFUSE_SECRET_KEY"] = ENV_CONFIG["langfuse_secret_key"]
        os.environ["LANGFUSE_HOST"] = ENV_CONFIG["langfuse_host"]

        # CallbackHandler reads from environment variables automatically
        return CallbackHandler()
    except Exception as e:
        print(f"Warning: Failed to initialize Langfuse: {e}")
        return None


def init_chat_model(model_name: str = None, temperature: float = None, max_tokens: int = None, tools: list = None):
    """
    Initialize chat model based on provider_type configuration.

    Supported provider types:
    - llamacpp: Uses ChatOpenAI with custom endpoint (llamacpp server with OpenAI-compatible API)
    - litellm: Uses ChatLiteLLM (gateway to multiple LLM providers)
    - openai: Uses ChatOpenAI (official OpenAI API or compatible services)
    """
    model_name = model_name or ENV_CONFIG["llm_model_name"]
    temperature = temperature if temperature is not None else ENV_CONFIG["llm_temperature"]
    max_tokens = max_tokens or ENV_CONFIG["llm_max_output_tokens"]

    provider_type = ENV_CONFIG["provider_type"]

    if provider_type == "llamacpp":
        # LlamaCpp server with OpenAI-compatible API
        model = ChatOpenAI(
            base_url=ENV_CONFIG["llamacpp_endpoint"],
            api_key=ENV_CONFIG["llamacpp_api_key"],
            model=model_name,
            temperature=temperature,
            max_tokens=max_tokens
        )

    elif provider_type == "litellm":
        # LiteLLM gateway
        model = ChatLiteLLM(
            api_base=ENV_CONFIG["litellm_endpoint"],
            api_key=ENV_CONFIG["litellm_api_key"],
            model=model_name,
            temperature=temperature,
            max_tokens=max_tokens
        )

    elif provider_type == "openai":
        # OpenAI or OpenAI-compatible service
        kwargs = {
            "model": model_name,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "api_key": ENV_CONFIG["openai_api_key"]
        }

        # Add custom endpoint if specified (for Azure OpenAI, etc.)
        if ENV_CONFIG.get("openai_endpoint"):
            kwargs["base_url"] = ENV_CONFIG["openai_endpoint"]

        model = ChatOpenAI(**kwargs)

    else:
        raise ValueError(f"Unsupported provider_type: {provider_type}. Must be 'llamacpp', 'litellm', or 'openai'")

    # Bind tools if provided
    if tools:
        model = model.bind_tools(tools)

    return model


LANGFUSE_HANDLER = _create_langfuse_handler()


# ==========================================
# TOOL FUNCTION DEFINITIONS
# ==========================================


@tool

def list_functions() -> dict:

    """List all discovered functions from the challenge binary"""
    base_url = "http://mcp_binary:8002"
    endpoint = "/mcp/list_functions"
    url = f"{base_url}{endpoint}"



    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e), "success": False}



@tool

def get_disassembly_by_function(
    function: str
) -> dict:

    """Fetch the disassembly for a specific function name"""
    base_url = "http://mcp_binary:8002"
    endpoint = "/mcp/get_disassembly_by_function"
    url = f"{base_url}{endpoint}"



    params = {}

    params["function"] = function

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e), "success": False}



@tool

def get_caller_callee_mapping(
    function_signature: str
) -> dict:

    """Return who a function calls within the binary"""
    base_url = "http://mcp_binary:8002"
    endpoint = "/mcp/get_caller_callee_mapping"
    url = f"{base_url}{endpoint}"



    params = {}

    params["function_signature"] = function_signature

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e), "success": False}



@tool

def get_callee_caller_mapping(
    function_signature: str
) -> dict:

    """Return which functions call the provided callee"""
    base_url = "http://mcp_binary:8002"
    endpoint = "/mcp/get_callee_caller_mapping"
    url = f"{base_url}{endpoint}"



    params = {}

    params["function_signature"] = function_signature

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e), "success": False}



@tool

def run_challenge(
    input: str
) -> dict:

    """Execute the challenge binary with a candidate password"""
    base_url = "http://mcp_binary:8002"
    endpoint = "/mcp/run_challenge"
    url = f"{base_url}{endpoint}"



    payload = {}

    payload["input"] = input

    try:
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e), "success": False}



@tool

def run_python(
    code: str,
    stdin: str = None
) -> dict:

    """Execute a Python snippet inside the challenge sandbox"""
    base_url = "http://mcp_binary:8002"
    endpoint = "/mcp/run_python"
    url = f"{base_url}{endpoint}"



    payload = {}

    payload["code"] = code

    if stdin is not None:
        payload["stdin"] = stdin

    try:
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e), "success": False}



# ==========================================
# STATE DEFINITIONS
# ==========================================


class GlobalState(TypedDict):
    """Global state shared across all nodes in the workflow."""
    count: Annotated[int, operator.add]  # Reducer: accumulate increments
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    functions_visited: Annotated[List[str], lambda x, y: x + y]
    output_report: str
    interesting_functions: Dict[str, str]
    executor_plan: str
    # Node 2 tracking
    node_2_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_2_llm_calls: Annotated[int, operator.add]  # Reducer: accumulate increments
    node_2_tool_iteration_count: int  # Direct set, no accumulation
    # Node 4 tracking
    node_4_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_4_llm_calls: Annotated[int, operator.add]  # Reducer: accumulate increments
    node_4_tool_iteration_count: int  # Direct set, no accumulation
    # Router tracking
    routing_reason: Optional[str]

# ==========================================
# PYDANTIC OUTPUT SCHEMAS
# ==========================================

class OutputSchema_2(BaseModel):
    """Structured output for Orchestrator (node 2)"""
    functions_visited: List[str] = Field(description="List of all the function addresses that were analyzed using the worker agents.")
    interesting_functions: Dict[str, str] = Field(description="Dictionary containing only the interesting functions as keys, and the reason why you find them interesting as value.")
    executor_plan: str = Field(description="A detailed plan for executor. This plan should contain the results of the binary analysis you performed, and what the executor agent needs to focus to solve the challenge.")

class OutputSchema_4(BaseModel):
    """Structured output for Executor (node 4)"""
    output_report: str = Field(description="final report containing information obtained using the executor agent")


# ==========================================
# WORKER TOOL FUNCTIONS
# ==========================================

#{ Template for worker as @tool decorated function #}
@tool
def worker_orchestrator_worker_3_tool(task: str) -> dict:
    """Performs specialized analysis and processing tasks delegated by the orchestrator.

The worker node can be given tasks like :
- Give me the list of the all the functions in the binary.
- Analyze functions function_addr1, function_addr2... and give me a summary of what each function does. 

The goal of the worker function is to aid the orchestrator in binary analysis. 

The argument is str, which will act as human message for the worker agent. 

# Note:
- Always pass comprehensive argument containing detailed information on how the task needs to be performed.
- Do not assume the worker node has intuition on how to solve the given task. Always give step by step approach on the worker node can achieve the task. 
    
    Args:
        task: The task to perform (treated as HumanMessage)
    
    Returns:
        dict: {"result": "...", "success": True/False}
    """
    # Build message list
    messages = []
    
    # Add system prompt
    system_prompt = "**Role:** You are a Reverse Engineering Worker Agent. Your role is to execute specific technical tasks delegated by the Orchestrator and provide high-fidelity data from the binary environment.\n\n**Objective:** Act as the hands and eyes of the Orchestrator. You do not decide *what* to analyze; you execute the analysis requested and report the findings accurately.\n\n**Technical Capabilities:**\nYou have direct access to a suite of binary analysis tools:\n1. `list_functions`: Returns a list of all identified function names and addresses.\n2. `get_disassembly_by_function`: Returns the assembly code for a specified function.\n3. `get_caller_callee_mapping`: Shows which functions a specific function calls.\n4. `get_callee_caller_mapping`: Shows which functions call a specific function (X-refs).\n5. `run_python`: Executes custom Python scripts for complex calculations, data manipulation, or emulation (e.g., using `z3` or `pwntools` if available).\n\n**Operational Guidelines:**\n- **Purity of Data:** Provide the raw output or a concise summary of the data requested. Do not add speculative theories unless specifically asked by the Orchestrator.\n- **Context Preservation:** When disassembling or mapping, ensure addresses and offsets are clearly labeled so the Orchestrator can track the control flow.\n- **Python Usage:** Use `run_python` only when the Orchestrator needs to verify a specific mathematical hypothesis or simulate a code snippet found in the disassembly.\n- **Efficiency:** If a function is exceptionally large, provide the most relevant blocks or the full disassembly as requested, but maintain clear formatting.\n\n**Output Protocol:**\n- If a tool call fails, report the error clearly.\n- If a tool returns no data, confirm that the target (e.g., a function name) does not exist in the current context."
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    
    # Add task as human message
    messages.append(HumanMessage(content=task))
    
    
    # Worker has tools - handle iteration limit
    max_iterations = 30
    current_iteration = 0

    while current_iteration < max_iterations:
        # ADD WARNING BEFORE MODEL INVOCATION (if approaching limit)
        remaining = max_iterations - current_iteration
        if remaining <= 3 and remaining > 0:
            warning_msg = HumanMessage(content="You are close to the tool iteration limit. Wrap up soon without more tool calls.")
            messages.append(warning_msg)

        # Invoke the model
        if LANGFUSE_HANDLER:
            response = model_worker_3.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
        else:
            response = model_worker_3.invoke(messages)
        messages.append(response)

        # Check for tool calls
        if hasattr(response, 'tool_calls') and response.tool_calls:
            current_iteration += 1

            # Check if we're at the limit
            if current_iteration >= max_iterations:
                # Hit limit - add warning and get final response
                warning_msg = HumanMessage(
                    content="Tool iteration limit reached. Please provide a final response without using more tools."
                )
                messages.append(warning_msg)
                if LANGFUSE_HANDLER:
                    final_response = model_worker_3.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
                else:
                    final_response = model_worker_3.invoke(messages)
                return {
                    "result": final_response.content if hasattr(final_response, 'content') else str(final_response),
                    "success": True
                }
            
            # Process tool calls
            for tool_call in response.tool_calls:
                # Get the tool by name
                tool_name = tool_call["name"]
                # Find tool in available tools for this worker
                tool_func = None
                if tool_name == "list_functions":
                    tool_func = list_functions
                elif tool_name == "get_disassembly_by_function":
                    tool_func = get_disassembly_by_function
                elif tool_name == "get_caller_callee_mapping":
                    tool_func = get_caller_callee_mapping
                elif tool_name == "get_callee_caller_mapping":
                    tool_func = get_callee_caller_mapping
                elif tool_name == "run_python":
                    tool_func = run_python
                
                if tool_func:
                    try:
                        observation = tool_func.invoke(tool_call["args"])
                        messages.append(ToolMessage(
                            content=str(observation),
                            tool_call_id=tool_call["id"]
                        ))
                    except Exception as e:
                        messages.append(ToolMessage(
                            content=f"Error executing tool: {str(e)}",
                            tool_call_id=tool_call["id"]
                        ))
                else:
                    messages.append(ToolMessage(
                        content=f"Tool '{tool_name}' not found",
                        tool_call_id=tool_call["id"]
                    ))
        else:
            # No tool calls - we have final response
            return {
                "result": response.content if hasattr(response, 'content') else str(response),
                "success": True
            }
    
    # Should not reach here, but return the last response
    return {
        "result": messages[-1].content if hasattr(messages[-1], 'content') else str(messages[-1]),
        "success": True
    }
    

#{ Template for worker as @tool decorated function #}
@tool
def worker_executor_worker_5_tool(task: str) -> dict:
    """Performs specialized analysis and processing tasks delegated by the executor agent.

The worker node can be given tasks like :
- Give me the list of the all the functions in the binary.
- Analyze functions function_addr1, function_addr2... and give me a summary of what each function does. 

The goal of the worker function is to aid the orchestrator in binary analysis. 

The argument is str, which will act as human message for the worker agent. 

# Note:
- Always pass comprehensive argument containing detailed information on how the task needs to be performed.
- Do not assume the worker node has intuition on how to solve the given task. Always give step by step approach on the worker node can achieve the task. 
    
    Args:
        task: The task to perform (treated as HumanMessage)
    
    Returns:
        dict: {"result": "...", "success": True/False}
    """
    # Build message list
    messages = []
    
    # Add system prompt
    system_prompt = "**Role:** You are the Technical Execution Specialist. Your role is to serve as the high-precision interface between the Executor Agent and the binary challenge environment.\n\n**Objective:** You provide the raw technical data and computational power required to turn a reverse engineering plan into a successful flag retrieval. You execute commands with mathematical and technical exactness.\n\n**Technical Toolset:**\n1. `list_functions`: Returns function names and addresses.\n2. `get_disassembly_by_function`: Returns the assembly code for a specific function.\n3. `get_caller_callee_mapping` / `get_callee_caller_mapping`: Provides control flow and X-ref data.\n4. `run_python`: Crucial for the execution phase. Use this to solve equations, generate payloads (e.g., using `struct.pack`), or automate constraint solving (e.g., `z3`).\n5. `run_challenge`:  Executes the binary with a provided input string or byte sequence and returns the STDOUT, STDERR, and exit status.\n\n**Operational Guidelines:**\n- **Execution-Focus:** You are often asked to find specific values (e.g., \"Find the constant compared against EAX at 0x4005fb\"). Be precise with hexadecimal and memory addresses.\n- **Trial \u0026 Observation:** When using `run_with_input`, report the results exactly as the binary produces them. Note any specific error messages or \"Wrong Password\" indicators that can help the Executor Agent debug its input.\n- **Python Scripting:** When the Executor asks you to \"solve\" a logic gate or a loop, use `run_python` to script a solution. Ensure the script is clean and focuses on outputting the required input for the challenge.\n- **Neutrality:** Do not speculate on the flag. Provide the data requested by the Executor so *they* can make the strategic decision.\n\n**Interaction Protocol:**\nYou will receive instructions (Human Messages) from the Executor Agent. Treat these as direct technical requirements. If an instruction is to test an input, use `run_with_input` and provide a detailed report of the binary\u0027s response."
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    
    # Add task as human message
    messages.append(HumanMessage(content=task))
    
    
    # Worker has tools - handle iteration limit
    max_iterations = 30
    current_iteration = 0

    while current_iteration < max_iterations:
        # ADD WARNING BEFORE MODEL INVOCATION (if approaching limit)
        remaining = max_iterations - current_iteration
        if remaining <= 3 and remaining > 0:
            warning_msg = HumanMessage(content="You are close to the tool iteration limit. Wrap up soon without more tool calls.")
            messages.append(warning_msg)

        # Invoke the model
        if LANGFUSE_HANDLER:
            response = model_worker_5.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
        else:
            response = model_worker_5.invoke(messages)
        messages.append(response)

        # Check for tool calls
        if hasattr(response, 'tool_calls') and response.tool_calls:
            current_iteration += 1

            # Check if we're at the limit
            if current_iteration >= max_iterations:
                # Hit limit - add warning and get final response
                warning_msg = HumanMessage(
                    content="Tool iteration limit reached. Please provide a final response without using more tools."
                )
                messages.append(warning_msg)
                if LANGFUSE_HANDLER:
                    final_response = model_worker_5.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
                else:
                    final_response = model_worker_5.invoke(messages)
                return {
                    "result": final_response.content if hasattr(final_response, 'content') else str(final_response),
                    "success": True
                }
            
            # Process tool calls
            for tool_call in response.tool_calls:
                # Get the tool by name
                tool_name = tool_call["name"]
                # Find tool in available tools for this worker
                tool_func = None
                if tool_name == "list_functions":
                    tool_func = list_functions
                elif tool_name == "get_disassembly_by_function":
                    tool_func = get_disassembly_by_function
                elif tool_name == "get_caller_callee_mapping":
                    tool_func = get_caller_callee_mapping
                elif tool_name == "get_callee_caller_mapping":
                    tool_func = get_callee_caller_mapping
                elif tool_name == "run_challenge":
                    tool_func = run_challenge
                elif tool_name == "run_python":
                    tool_func = run_python
                
                if tool_func:
                    try:
                        observation = tool_func.invoke(tool_call["args"])
                        messages.append(ToolMessage(
                            content=str(observation),
                            tool_call_id=tool_call["id"]
                        ))
                    except Exception as e:
                        messages.append(ToolMessage(
                            content=f"Error executing tool: {str(e)}",
                            tool_call_id=tool_call["id"]
                        ))
                else:
                    messages.append(ToolMessage(
                        content=f"Tool '{tool_name}' not found",
                        tool_call_id=tool_call["id"]
                    ))
        else:
            # No tool calls - we have final response
            return {
                "result": response.content if hasattr(response, 'content') else str(response),
                "success": True
            }
    
    # Should not reach here, but return the last response
    return {
        "result": messages[-1].content if hasattr(messages[-1], 'content') else str(messages[-1]),
        "success": True
    }
    


# ==========================================
# MODEL INSTANCES (initialized once)
# ==========================================

# Model for LLM node 2 (with tools)
model_2 = init_chat_model(tools=[worker_orchestrator_worker_3_tool])

# Model for LLM node 4 (with tools)
model_4 = init_chat_model(tools=[run_challenge, worker_executor_worker_5_tool])

# Model for worker node 3 (with tools)
model_worker_3 = init_chat_model(tools=[list_functions, get_disassembly_by_function, get_caller_callee_mapping, get_callee_caller_mapping, run_python])

# Model for worker node 5 (with tools)
model_worker_5 = init_chat_model(tools=[list_functions, get_disassembly_by_function, get_caller_callee_mapping, get_callee_caller_mapping, run_challenge, run_python])


# ==========================================
# TOOL GROUPS
# ==========================================

tools_for_node_2 = [worker_orchestrator_worker_3_tool]
tools_by_name_for_node_2 = {tool.name: tool for tool in tools_for_node_2}

tools_for_node_4 = [run_challenge, worker_executor_worker_5_tool]
tools_by_name_for_node_4 = {tool.name: tool for tool in tools_for_node_4}


# ==========================================
# LLM NODE FUNCTIONS
# ==========================================

#{ Template for generating LLM node function with Command pattern - Single Global State #}
def orchestrator_2_node(global_state: GlobalState) -> Command:
    """LLM Node 2: Orchestrator"""
    
    # Build message list
    messages = []

    # Get conversation history from node-specific messages in global state
    node_messages = global_state.get("node_2_messages", [])

    if len(node_messages) == 0:
        # FIRST INVOCATION ONLY - add system and human prompts
        system_prompt_rendered = render_template("**Role:** You are the Lead Orchestrator and Expert CTF Strategist. Your goal is to guide the analysis of a reverse engineering challenge by managing a Worker Agent.\n\n**The Orchestration Protocol:**\n1. **Delegation Only:** You do not have direct access to binary analysis tools. You MUST interact with the binary through the `worker` tool call.\n2. **Worker Interaction:** Every time you call the `worker`, the text you provide as input will serve as the **Human Message** (instruction) for that Worker. Be technical, imperative, and specific in your requests.\n3. **Analytical Duty:** You are responsible for identifying the \"Win Condition\" of the binary. You must track control flow, identify security checks (e.g., password comparisons, anti-debugging), and determine how the flag is generated or revealed.\n\n**Worker Capabilities (Accessible via tool call):**\n- `list_functions`: Overview of all functions.\n- `get_disassembly_by_function`: Detailed assembly code.\n- `get_caller_callee_mapping` / `get_callee_caller_mapping`: Call graph navigation.\n- `run_python`: Scripting for algorithmic analysis or emulation.\n\n**Final Mission Deliverable:**\nOnce you have mapped the binary\u2019s logic, you must terminate the session by outputting a final report in the following structured format:\n\n1. **functions_visited** (List[str]): A comprehensive list of all function addresses/names that were analyzed via the worker.\n2. **interesting_functions** (Dict[str, str]): A dictionary where keys are function names/addresses and values are the technical justification for their importance.\n3. **orchestrator_plan** (str): A detailed, step-by-step guide for an \"Executor\" agent. This should summarize the binary\u0027s logic, identified constraints, and the specific path required to obtain the flag.\n\n**Constraint:** Do not solve the challenge yourself. Your job is to create the blueprint for the solve.", global_state)
        if system_prompt_rendered:
            messages.append(SystemMessage(content=system_prompt_rendered))

        # Add human prompt if provided
        human_prompt_rendered = render_template("### New CTF Challenge: [Insert Challenge Name]\n\n**Context:** [Insert brief context, e.g., \"This is a statically linked ELF 64-bit binary found on a remote server.\"]\n\n**Objective:** Please begin the orchestration process. \n1. Use the `worker` tool to perform initial reconnaissance (e.g., listing functions).\n2. Direct the worker to deep-dive into the entry points or suspicious logic you discover.\n3. Maintain your internal state of `functions_visited` and `interesting_functions`.\n\n**Final Goal:** Provide the structured plan for the Executor once you understand the binary\u0027s flow.\n\nBegin by issuing your first command to the `worker`.", global_state)
        if human_prompt_rendered:
            # Append input state keys to human message
            human_message_content = human_prompt_rendered

            messages.append(HumanMessage(content=human_message_content))
    else:
        # SUBSEQUENT INVOCATIONS - use existing conversation history
        messages.extend(node_messages)
    
    
    # TWO-PHASE EXECUTION: Check if returning from tool iteration
    current_iteration = global_state.get("node_2_tool_iteration_count", 0)

    if current_iteration > 0:
        # Coming back from tool execution

        # ADD WARNING BEFORE INVOKING MODEL (if approaching limit)
        max_iterations = 30
        if current_iteration >= max_iterations - 3 and current_iteration < max_iterations:
            remaining = max_iterations - current_iteration
            warning_msg = HumanMessage(
                content="You are close to the tool iteration limit. Wrap up soon without more tool calls."
            )
            messages.append(warning_msg)

        # Now apply structured output to get final response
        model_with_output = model_2.with_structured_output(OutputSchema_2)
        if LANGFUSE_HANDLER:
            structured_response = model_with_output.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
        else:
            structured_response = model_with_output.invoke(messages)
        
        state_updates = {
            "count": 1,
            "messages": [AIMessage(content=str(structured_response))],
            "node_2_messages": [AIMessage(content=str(structured_response))],
            "node_2_llm_calls": 1,
            "node_2_tool_iteration_count": 0
        }
        # Extract and validate output state keys
        if not hasattr(structured_response, 'functions_visited'):
            raise ValueError(f"Output field 'functions_visited' not found in structured output from node 2")
        state_updates['functions_visited'] = getattr(structured_response, 'functions_visited')
        if not hasattr(structured_response, 'interesting_functions'):
            raise ValueError(f"Output field 'interesting_functions' not found in structured output from node 2")
        state_updates['interesting_functions'] = getattr(structured_response, 'interesting_functions')
        if not hasattr(structured_response, 'executor_plan'):
            raise ValueError(f"Output field 'executor_plan' not found in structured output from node 2")
        state_updates['executor_plan'] = getattr(structured_response, 'executor_plan')
        
        return Command(
            update=state_updates,
            goto="executor_4_node"
        )
    
    # First invocation - invoke model WITHOUT structured output to allow tool calls
    if LANGFUSE_HANDLER:
        response = model_2.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
    else:
        response = model_2.invoke(messages)
    
    # Check if response contains tool calls
    if hasattr(response, 'tool_calls') and response.tool_calls:
        # Has tool calls - route to tool node for execution
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_2_messages": [response],
                "node_2_llm_calls": 1
            },
            goto="tool_2_node"
        )
    
    # No tool calls on first try - apply structured output
    messages.append(response)
    messages.append(HumanMessage(
        content="Please format your previous response according to the required output schema."
    ))

    model_with_output = model_2.with_structured_output(OutputSchema_2)
    if LANGFUSE_HANDLER:
        structured_response = model_with_output.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
    else:
        structured_response = model_with_output.invoke(messages)
    
    state_updates = {
        "count": 1,
        "messages": [AIMessage(content=str(structured_response))],
        "node_2_messages": [AIMessage(content=str(structured_response))],
        "node_2_llm_calls": 1,
        "node_2_tool_iteration_count": 0
    }
    # Extract and validate output state keys
    if not hasattr(structured_response, 'functions_visited'):
        raise ValueError(f"Output field 'functions_visited' not found in structured output from node 2")
    state_updates['functions_visited'] = getattr(structured_response, 'functions_visited')
    if not hasattr(structured_response, 'interesting_functions'):
        raise ValueError(f"Output field 'interesting_functions' not found in structured output from node 2")
    state_updates['interesting_functions'] = getattr(structured_response, 'interesting_functions')
    if not hasattr(structured_response, 'executor_plan'):
        raise ValueError(f"Output field 'executor_plan' not found in structured output from node 2")
    state_updates['executor_plan'] = getattr(structured_response, 'executor_plan')
    
    return Command(
        update=state_updates,
        goto="executor_4_node"
    )
    
    

#{ Template for generating LLM node function with Command pattern - Single Global State #}
def executor_4_node(global_state: GlobalState) -> Command:
    """LLM Node 4: Executor"""
    
    # Build message list
    messages = []

    # Get conversation history from node-specific messages in global state
    node_messages = global_state.get("node_4_messages", [])

    if len(node_messages) == 0:
        # FIRST INVOCATION ONLY - add system and human prompts
        system_prompt_rendered = render_template("**Role:** You are the Lead CTF Executor. Your mission is to take a high-level reverse engineering plan and execute the technical steps required to retrieve the flag.\n\n**Input Context:**\nYou will receive:\n1. **functions_visited**: A list of functions already analyzed by the Orchestrator.\n2. **interesting_functions**: A dictionary of critical functions and their technical significance.\n3. **executor_plan**: The strategic roadmap you must follow.\n\n**Your Tools:**\n1. **executor_worker**: Use this tool for technical operations (disassembly, call graph analysis, or Python scripting). \n    - *Note:* The input you provide to this tool acts as its Human Message. Use imperative, technical commands.\n    - *Enhanced Capability:* This worker can run the binary with specific inputs to observe behavior.\n2. **run_challenge**: Use this tool to execute the challenge binary with a candidate input/payload to attempt flag retrieval.\n\n**Execution Protocol:**\n- **Refinement:** Use the `executor_worker` to extract specific constants, offsets, or logic details mentioned in the `executor_plan`.\n- **Computation:** Use `executor_worker`\u0027s `run_python` to solve constraints (e.g., Z3), generate payloads, or reverse custom algorithms.\n- **Verification:** Test your solutions using `run_challenge`. If it fails, use the worker to debug the output and iterate.\n\n**Output Protocol:**\nOnce you have either retrieved the flag or exhausted all technical possibilities based on the plan, you must provide your final response in this format:\n\n- **output_report** (str): A comprehensive summary of your actions. \n    - If successful: Include the **flag** and a brief explanation of how it was obtained.\n    - If unsuccessful: Explain exactly where the process failed, what was attempted, and why the flag remained inaccessible.", global_state)
        if system_prompt_rendered:
            messages.append(SystemMessage(content=system_prompt_rendered))

        # Add human prompt if provided
        human_prompt_rendered = render_template("### CTF Execution Phase: Flag Retrieval\n\n**Task:** You are now in the execution phase. Use the intelligence provided by the Orchestrator to interact with the binary and extract the flag.\n\n---\n### Global Context:\n**Functions Visited:** {{functions_visited}}\n\n**Interesting Functions:** {{interesting_functions}}\n\n**Executor Plan:** {{executor_plan}}\n---\n\n**Current Environment:** - You have access to the `executor_worker` for further analysis/scripting.\n- You have access to `run_challenge` to test inputs.\n\n**Instructions:** 1. Review the plan and identify the first technical hurdle. \n2. Use the worker to gather any missing data or solve the necessary logic.\n3. Attempt to retrieve the flag.\n4. When finished, provide your final **output_report**.\n\nPlease begin your first action.", global_state)
        if human_prompt_rendered:
            # Append input state keys to human message
            human_message_content = human_prompt_rendered
            # Add input state keys section
            human_message_content += "\n\n## Input:\n"
            human_message_content += f"\n### functions_visited:\n{global_state.get('functions_visited', 'Not available')}\n"
            human_message_content += f"\n### interesting_functions:\n{global_state.get('interesting_functions', 'Not available')}\n"

            messages.append(HumanMessage(content=human_message_content))
    else:
        # SUBSEQUENT INVOCATIONS - use existing conversation history
        messages.extend(node_messages)
    
    
    # TWO-PHASE EXECUTION: Check if returning from tool iteration
    current_iteration = global_state.get("node_4_tool_iteration_count", 0)

    if current_iteration > 0:
        # Coming back from tool execution

        # ADD WARNING BEFORE INVOKING MODEL (if approaching limit)
        max_iterations = 30
        if current_iteration >= max_iterations - 3 and current_iteration < max_iterations:
            remaining = max_iterations - current_iteration
            warning_msg = HumanMessage(
                content="You are close to the tool iteration limit. Wrap up soon without more tool calls."
            )
            messages.append(warning_msg)

        # Now apply structured output to get final response
        model_with_output = model_4.with_structured_output(OutputSchema_4)
        if LANGFUSE_HANDLER:
            structured_response = model_with_output.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
        else:
            structured_response = model_with_output.invoke(messages)
        
        state_updates = {
            "count": 1,
            "messages": [AIMessage(content=str(structured_response))],
            "node_4_messages": [AIMessage(content=str(structured_response))],
            "node_4_llm_calls": 1,
            "node_4_tool_iteration_count": 0
        }
        # Extract and validate output state keys
        if not hasattr(structured_response, 'output_report'):
            raise ValueError(f"Output field 'output_report' not found in structured output from node 4")
        state_updates['output_report'] = getattr(structured_response, 'output_report')
        
        return Command(
            update=state_updates,
            goto="END"
        )
    
    # First invocation - invoke model WITHOUT structured output to allow tool calls
    if LANGFUSE_HANDLER:
        response = model_4.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
    else:
        response = model_4.invoke(messages)
    
    # Check if response contains tool calls
    if hasattr(response, 'tool_calls') and response.tool_calls:
        # Has tool calls - route to tool node for execution
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_4_messages": [response],
                "node_4_llm_calls": 1
            },
            goto="tool_4_node"
        )
    
    # No tool calls on first try - apply structured output
    messages.append(response)
    messages.append(HumanMessage(
        content="Please format your previous response according to the required output schema."
    ))

    model_with_output = model_4.with_structured_output(OutputSchema_4)
    if LANGFUSE_HANDLER:
        structured_response = model_with_output.invoke(messages, config={"callbacks": [LANGFUSE_HANDLER]})
    else:
        structured_response = model_with_output.invoke(messages)
    
    state_updates = {
        "count": 1,
        "messages": [AIMessage(content=str(structured_response))],
        "node_4_messages": [AIMessage(content=str(structured_response))],
        "node_4_llm_calls": 1,
        "node_4_tool_iteration_count": 0
    }
    # Extract and validate output state keys
    if not hasattr(structured_response, 'output_report'):
        raise ValueError(f"Output field 'output_report' not found in structured output from node 4")
    state_updates['output_report'] = getattr(structured_response, 'output_report')
    
    return Command(
        update=state_updates,
        goto="END"
    )
    
    

# ==========================================
# TOOL NODE FUNCTIONS
# ==========================================

#{ Template for generating tool node function with Command pattern - Single Global State #}
def tool_2_node(global_state: GlobalState) -> Command:
    """Tool node for LLM node 2 - performs tool calls with iteration tracking."""
    
    messages = global_state.get("node_2_messages", [])
    if not messages:
        return Command(update={}, goto="orchestrator_2_node")
    
    last_message = messages[-1]
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return Command(update={}, goto="orchestrator_2_node")
    
    # Get current iteration count and max from global state
    current_iteration = global_state.get("node_2_tool_iteration_count", 0)
    max_iterations = 30
    
    # Check iteration limit BEFORE processing
    if current_iteration >= max_iterations:
        # Hit limit - return to LLM without processing tools
        warning_msg = HumanMessage(
            content="Tool iteration limit reached. Please provide a final response without using more tools."
        )
        return Command(
            update={
                "messages": [warning_msg],
                "node_2_messages": [warning_msg]
            },
            goto="orchestrator_2_node"
        )
    
    # Process tool calls
    result = []
    for tool_call in last_message.tool_calls:
        tool = tools_by_name_for_node_2.get(tool_call["name"])
        if tool:
            observation = tool.invoke(tool_call["args"])
            result.append(ToolMessage(content=str(observation), tool_call_id=tool_call["id"]))
        else:
            result.append(ToolMessage(
                content=f"Error: Tool '{tool_call['name']}' not found",
                tool_call_id=tool_call["id"]
            ))

    # WARNING: Do NOT append HumanMessage warnings here - they break AIMessage->ToolMessage sequence
    # Warnings are now handled in the LLM node BEFORE the next model invocation

    # Return Command routing back to LLM node - update both global and node-specific messages
    return Command(
        update={
            "messages": result,
            "node_2_messages": result,
            "node_2_tool_iteration_count": current_iteration + 1
        },
        goto="orchestrator_2_node"
    )

#{ Template for generating tool node function with Command pattern - Single Global State #}
def tool_4_node(global_state: GlobalState) -> Command:
    """Tool node for LLM node 4 - performs tool calls with iteration tracking."""
    
    messages = global_state.get("node_4_messages", [])
    if not messages:
        return Command(update={}, goto="executor_4_node")
    
    last_message = messages[-1]
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return Command(update={}, goto="executor_4_node")
    
    # Get current iteration count and max from global state
    current_iteration = global_state.get("node_4_tool_iteration_count", 0)
    max_iterations = 30
    
    # Check iteration limit BEFORE processing
    if current_iteration >= max_iterations:
        # Hit limit - return to LLM without processing tools
        warning_msg = HumanMessage(
            content="Tool iteration limit reached. Please provide a final response without using more tools."
        )
        return Command(
            update={
                "messages": [warning_msg],
                "node_4_messages": [warning_msg]
            },
            goto="executor_4_node"
        )
    
    # Process tool calls
    result = []
    for tool_call in last_message.tool_calls:
        tool = tools_by_name_for_node_4.get(tool_call["name"])
        if tool:
            observation = tool.invoke(tool_call["args"])
            result.append(ToolMessage(content=str(observation), tool_call_id=tool_call["id"]))
        else:
            result.append(ToolMessage(
                content=f"Error: Tool '{tool_call['name']}' not found",
                tool_call_id=tool_call["id"]
            ))

    # WARNING: Do NOT append HumanMessage warnings here - they break AIMessage->ToolMessage sequence
    # Warnings are now handled in the LLM node BEFORE the next model invocation

    # Return Command routing back to LLM node - update both global and node-specific messages
    return Command(
        update={
            "messages": result,
            "node_4_messages": result,
            "node_4_tool_iteration_count": current_iteration + 1
        },
        goto="executor_4_node"
    )


# ==========================================
# GRAPH CONSTRUCTION
# ==========================================

#{ Template for graph construction with Command pattern (simplified) #}

# Build the state graph
graph_builder = StateGraph(GlobalState)

# ==========================================
# ADD NODES
# ==========================================
# Add node: orchestrator_2_node
graph_builder.add_node("orchestrator_2_node", orchestrator_2_node)
# Add node: executor_4_node
graph_builder.add_node("executor_4_node", executor_4_node)
# Add node: tool_2_node
graph_builder.add_node("tool_2_node", tool_2_node)
# Add node: tool_4_node
graph_builder.add_node("tool_4_node", tool_4_node)

# ==========================================
# SET ENTRY POINT
# ==========================================
graph_builder.set_entry_point("orchestrator_2_node")

# ==========================================
# COMPILE GRAPH
# ==========================================
# Note: With Command pattern, nodes handle their own routing!
# No need to manually define edges - they're determined by Command.goto

compiled_graph = graph_builder.compile()


# ==========================================
# RUN FUNCTION (Entry Point)
# ==========================================

def run(initial_state: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Run the compiled agent workflow.
    
    Args:
        initial_state: Optional initial state dictionary
    
    Returns:
        Final state dictionary after workflow execution
    """
    if initial_state is None:
        initial_state = {}
    
    # Invoke the compiled graph
    final_state = compiled_graph.invoke(initial_state)
    return final_state


# ==========================================
# MAIN EXECUTION (CLI)
# ==========================================

if __name__ == "__main__":
    print("Compiled ASL code - ready to execute")
    
    # Example: Run with empty initial state
    # result = run({})
    # print(json.dumps(result, default=str, indent=2))
