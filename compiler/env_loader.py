"""
This module handles loading all the environment variables required by the compiler.
The variables inlcude:
- LLM Configuration:
    - Model Name
    - Temperature
    - Context Window Size
    - Max Output Tokens
    - Model Endpoint (has to be litellm endpoint)
    - API Key
- LangFuse Configuration:
    - LangFuse API Key
    - LangFuse Project Name
"""

from dotenv import load_dotenv
import os

load_dotenv(".env")

def get_env_variables():
    env_vars = {
        "LLM_MODEL_NAME": os.getenv("llm_model_name", ""),
        "LLM_TEMPERATURE": float(os.getenv("llm_temperature", "0.0")),
        "LLM_CONTEXT_WINDOW": int(os.getenv("llm_context_window", "8192")),
        "LLM_MAX_OUTPUT_TOKENS": int(os.getenv("llm_max_output_tokens", "4096")),
        "LLM_ENDPOINT": os.getenv("llm_endpoint", ""),
        "LLM_API_KEY": os.getenv("llm_api_key", ""),
        "LANGFUSE_API_KEY": os.getenv("langfuse_api_key", ""),
        "LANGFUSE_PROJECT_NAME": os.getenv("langfuse_project_name", "default_project"),
    }
    return env_vars