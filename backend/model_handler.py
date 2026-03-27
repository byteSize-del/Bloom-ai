"""
Offline AI Chat - Ollama Model Handler
Handles communication with Ollama API for AI model inference.
"""

import httpx
import asyncio
import json
import os
from typing import List, Dict, Any, AsyncGenerator
from dataclasses import dataclass


@dataclass
class OllamaConfig:
    """Configuration for Ollama connection."""
    host: str = "http://localhost"
    port: int = 11434
    api_endpoint: str = "/api/chat"
    models_endpoint: str = "/api/tags"
    timeout: float = 60.0

    @property
    def base_url(self) -> str:
        return f"{self.host}:{self.port}"


class OllamaHandler:
    """Handler for Ollama API operations."""

    def __init__(self, config: OllamaConfig = None):
        self.config = config or OllamaConfig()
        self.client = None

    async def __aenter__(self):
        """Async context manager entry."""
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.config.timeout),
            headers={"Content-Type": "application/json"}
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.client:
            await self.client.aclose()

    async def get_available_models(self) -> List[Dict[str, Any]]:
        """
        Get list of all installed Ollama models.

        Returns:
            List of model information dictionaries
        """
        try:
            url = f"{self.config.base_url}{self.config.models_endpoint}"
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.config.timeout)) as client:
                response = await client.get(url)

                if response.status_code == 200:
                    data = response.json()
                    models = data.get("models", [])

                    # Transform to standard format
                    return [
                        {
                            "name": model.get("name", "unknown"),
                            "model": model.get("model", "unknown"),
                            "modified_at": model.get("modified_at", ""),
                            "size": model.get("size", 0),
                            "digest": model.get("digest", ""),
                            "details": model.get("details", {})
                        }
                        for model in models
                    ]
                else:
                    print(f"Ollama API returned status {response.status_code}")
                    return []

        except httpx.RequestError as e:
            print(f"Failed to fetch models: {e}")
            return []
        except Exception as e:
            print(f"Error fetching models: {e}")
            return []

    async def stream_chat(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        system_prompt: str = ""
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream chat completions from Ollama using server-sent events.

        Args:
            model: Model name to use
            messages: Conversation history as list of {role, content} pairs
            temperature: Sampling temperature (0.0 to 1.0)
            system_prompt: Optional system prompt to prepend

        Yields:
            Chunks of the AI response
        """
        # Build the request payload
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": temperature
            }
        }

        try:
            url = f"{self.config.base_url}{self.config.api_endpoint}"
            headers = {"Content-Type": "application/json"}

            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.config.timeout),
                headers=headers
            ) as client:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code == 200:
                        async for line in response.aiter_lines():
                            if line:
                                try:
                                    data = json.loads(line)
                                    if "message" in data:
                                        content = data["message"].get("content", "")
                                        if content:
                                            yield {"content": content}
                                    elif "done" in data:
                                        yield {"done": True}
                                except json.JSONDecodeError:
                                    # Skip malformed JSON lines
                                    continue
                    else:
                        error_msg = f"Ollama API error: {response.status_code}"
                        yield {"error": error_msg}

        except httpx.TimeoutException:
            yield {"error": "Request timeout"}
        except httpx.RequestError as e:
            yield {"error": f"Connection error: {str(e)}"}
        except Exception as e:
            yield {"error": f"Unexpected error: {str(e)}"}

    async def chat(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.7
    ) -> str:
        """
        Get a complete chat completion (non-streaming).

        Args:
            model: Model name to use
            messages: Conversation history
            temperature: Sampling temperature

        Returns:
            The complete AI response
        """
        try:
            url = f"{self.config.base_url}{self.config.api_endpoint}"
            payload = {
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature}
            }

            async with httpx.AsyncClient(timeout=httpx.Timeout(self.config.timeout)) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()

                data = response.json()
                return data.get("message", {}).get("content", "")

        except Exception as e:
            return f"Error: {str(e)}"


async def test_ollama_connection():
    """Test function to verify Ollama connection."""
    async with OllamaHandler() as handler:
        models = await handler.get_available_models()
        print(f"Available models: {len(models)}")
        for model in models:
            print(f"  - {model['name']}")

        if models:
            # Test a simple chat
            test_messages = [{"role": "user", "content": "Hello!"}]
            print("\nTesting chat...")
            async for chunk in handler.stream_chat(
                model=models[0]["name"],
                messages=test_messages
            ):
                if "content" in chunk:
                    print(chunk["content"], end="", flush=True)
                elif "done" in chunk:
                    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(test_ollama_connection())
