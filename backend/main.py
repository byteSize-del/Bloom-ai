"""
Offline AI Chat - FastAPI Backend
Main application entry point
"""

import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import asyncio

import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from model_handler import OllamaHandler
from chat_history import ChatHistoryManager

# Initialize FastAPI app
app = FastAPI(
    title="Offline AI Chat API",
    description="Backend API for offline AI desktop chat application"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize handlers
ollama_handler = OllamaHandler()
chat_history_manager = ChatHistoryManager()


# Request/Response Models
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    model: str
    history: List[Dict[str, str]] = []
    temperature: Optional[float] = 0.7
    system_prompt: Optional[str] = ""


class SessionRequest(BaseModel):
    title: Optional[str] = None
    model: str
    messages: List[Dict[str, str]] = []

def normalize_chat_role(role: str) -> str:
    normalized = str(role or "").strip().lower()
    if normalized in {"assistant", "ai", "bot", "model"}:
        return "assistant"
    if normalized == "system":
        return "system"
    return "user"


# Health endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for Electron to verify backend is running."""
    return {"status": "healthy", "backend": "running"}


# Get available models from Ollama
@app.get("/models")
async def get_models():
    """Returns list of locally installed Ollama models."""
    try:
        models = await ollama_handler.get_available_models()
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch models: {str(e)}")


# Send message and get streaming response
@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Send a message to the AI model and receive a streaming response.
    Uses Ollama's /api/chat endpoint with streaming support.
    """
    try:
        async def generate_response():
            try:
                messages = []

                # Add system prompt if provided
                if request.system_prompt:
                    messages.append({"role": "system", "content": request.system_prompt})

                # Add conversation history
                for msg in request.history:
                    messages.append({
                        "role": normalize_chat_role(msg.get("role", "user")),
                        "content": msg.get("content", "")
                    })

                # Add current user message
                messages.append({"role": "user", "content": request.message})

                # Stream response from Ollama
                async for chunk in ollama_handler.stream_chat(
                    model=request.model,
                    messages=messages,
                    temperature=request.temperature
                ):
                    if isinstance(chunk, dict):
                        if "content" in chunk:
                            yield f"data: {json.dumps(chunk)}\n\n"
                        elif "done" in chunk:
                            yield f"data: {json.dumps({'done': True})}\n\n"
                        elif "error" in chunk:
                            yield f"data: {json.dumps({'error': chunk['error']})}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(
            generate_response(),
            media_type="text/event-stream"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Save chat history
@app.post("/history/save")
async def save_chat_history(session: SessionRequest):
    """Save a chat session to persistent storage."""
    import traceback
    try:
        # Convert Pydantic model to dict
        session_dict = {
            "title": session.title,
            "model": session.model,
            "messages": session.messages
        }
        print(f"Save request received: model={session_dict['model']}, messages={len(session_dict['messages'])}")
        session_id = await chat_history_manager.save_session(session_dict)
        print(f"Session saved: {session_id}")
        return {"success": True, "sessionId": session_id}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


# Load all chat sessions
@app.get("/history/load")
async def load_chat_history():
    """Load all saved chat sessions."""
    try:
        sessions = await chat_history_manager.load_all_sessions()
        return {"sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Load specific session
@app.get("/history/{session_id}")
async def load_session(session_id: str):
    """Load a specific chat session by ID."""
    try:
        session = await chat_history_manager.load_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Delete session
@app.delete("/history/{session_id}")
async def delete_session(session_id: str):
    """Delete a specific chat session."""
    try:
        await chat_history_manager.delete_session(session_id)
        return {"success": True, "message": "Session deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Generate title from messages
@app.post("/history/generate-title")
async def generate_title(messages: List[Dict[str, str]]):
    """Generate a title from the first user message."""
    try:
        title = await chat_history_manager.generate_title(messages)
        return {"title": title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Settings endpoints
@app.get("/settings")
async def get_settings():
    """Get current settings."""
    try:
        settings = chat_history_manager.load_settings()
        return settings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/settings")
async def update_settings(settings: Dict[str, Any]):
    """Update settings."""
    try:
        chat_history_manager.save_settings(settings)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.on_event("startup")
async def startup_event():
    """Startup hook to initialize the app."""
    data_dir = os.environ.get("DATA_DIR", os.path.join(os.path.expanduser("~"), ".offline-ai-chat", "sessions"))
    os.makedirs(data_dir, exist_ok=True)
    print(f"Backend initialized. Data directory: {data_dir}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info"
    )
