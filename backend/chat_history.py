"""
Offline AI Chat - Chat History Manager
Handles saving and loading chat sessions to/from JSON files.
"""

import os
import json
import uuid
import re
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
import asyncio


class ChatHistoryManager:
    """Manages chat session persistence and history."""

    def __init__(self, data_dir: str = None):
        # Use environment variable or default app data directory
        self.data_dir = data_dir or os.environ.get(
            "DATA_DIR",
            os.path.join(os.path.expanduser("~"), ".offline-ai-chat", "sessions")
        )
        self.settings_file = os.path.join(
            os.path.expanduser("~"),
            ".offline-ai-chat",
            "settings.json"
        )
        os.makedirs(self.data_dir, exist_ok=True)

    async def save_session(self, session_data) -> str:
        """
        Save a chat session to a JSON file.

        Args:
            session_data: Contains title, model, and messages (can be dict or SessionRequest)

        Returns:
            The session ID
        """
        session_id = str(uuid.uuid4())

        # Handle both dict and SessionRequest (Pydantic model)
        if hasattr(session_data, '__dict__'):
            # It's a Pydantic model (SessionRequest)
            title = getattr(session_data, 'title', None)
            model = getattr(session_data, 'model', 'llama3')
            messages = getattr(session_data, 'messages', [])
        else:
            # It's a dict
            title = session_data.get("title")
            model = session_data.get("model", "llama3")
            messages = session_data.get("messages", [])

        if not title:
            title = await self.generate_title(messages)

        # Create session object
        session = {
            "id": session_id,
            "title": title,
            "model": model,
            "createdAt": datetime.utcnow().isoformat(),
            "messages": messages
        }

        # Save to file
        filepath = os.path.join(self.data_dir, f"{session_id}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(session, f, indent=2, ensure_ascii=False)

        return session_id

    async def load_all_sessions(self) -> List[Dict[str, Any]]:
        """
        Load all saved chat sessions.

        Returns:
            List of session metadata dictionaries
        """
        sessions = []

        try:
            for filename in os.listdir(self.data_dir):
                if filename.endswith(".json"):
                    filepath = os.path.join(self.data_dir, filename)
                    try:
                        with open(filepath, "r", encoding="utf-8") as f:
                            session = json.load(f)
                            sessions.append({
                                "id": session.get("id"),
                                "title": session.get("title", "Untitled"),
                                "model": session.get("model", "llama3"),
                                "createdAt": session.get("createdAt", ""),
                                "messageCount": len(session.get("messages", [])),
                                "lastMessage": session.get("messages", [])[-1]["content"] if session.get("messages") else ""
                            })
                    except (json.JSONDecodeError, IOError) as e:
                        print(f"Error loading {filename}: {e}")

            # Sort by creation date (newest first)
            sessions.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

        except OSError as e:
            print(f"Error reading session directory: {e}")

        return sessions

    async def load_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a specific chat session by ID.

        Args:
            session_id: The ID of the session to load

        Returns:
            The complete session object or None if not found
        """
        filepath = os.path.join(self.data_dir, f"{session_id}.json")

        try:
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error loading session {session_id}: {e}")

        return None

    async def delete_session(self, session_id: str) -> bool:
        """
        Delete a chat session.

        Args:
            session_id: The ID of the session to delete

        Returns:
            True if successful, False otherwise
        """
        filepath = os.path.join(self.data_dir, f"{session_id}.json")

        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                return True
        except OSError as e:
            print(f"Error deleting session {session_id}: {e}")

        return False

    async def get_session_count(self) -> int:
        """Get the total number of saved sessions."""
        try:
            return len([f for f in os.listdir(self.data_dir) if f.endswith(".json")])
        except OSError:
            return 0

    async def generate_title(self, messages: List[Dict[str, str]]) -> str:
        """
        Generate a session title from the first user message.

        Args:
            messages: List of message objects

        Returns:
            Generated title (first 6 words from first user message)
        """
        # Find the first user message
        for msg in messages:
            if msg.get("role") == "user" and msg.get("content"):
                content = msg["content"].strip()

                # Remove markdown and special characters
                content = re.sub(r'[^\w\s]', '', content)
                content = re.sub(r'\s+', ' ', content)

                # Take first 6 words
                words = content.split()[:6]
                title = ' '.join(words)

                if len(words) >= 6:
                    title += "..."

                return title if title else "New Chat"

        return "New Chat"

    def save_settings(self, settings: Dict[str, Any]) -> None:
        """
        Save application settings.

        Args:
            settings: Dictionary of settings to save
        """
        try:
            with open(self.settings_file, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Error saving settings: {e}")

    def load_settings(self) -> Dict[str, Any]:
        """
        Load application settings.

        Returns:
            Dictionary of settings (defaults if not found)
        """
        defaults = {
            "theme": "dark",
            "systemPrompt": "You are a helpful AI assistant. Provide clear, concise responses.",
            "temperature": 0.7,
            "defaultModel": "llama3"
        }

        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    defaults.update(loaded)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error loading settings: {e}")

        return defaults


# Module-level instance
chat_manager = ChatHistoryManager()


async def test_chat_history():
    """Test function for chat history management."""
    manager = ChatHistoryManager()

    # Test saving a session
    test_session = {
        "title": "Test Chat",
        "model": "llama3",
        "messages": [
            {"role": "user", "content": "Hello, how are you?"},
            {"role": "assistant", "content": "I'm doing well, thank you! How can I help you today?"}
        ]
    }

    session_id = await manager.save_session(test_session)
    print(f"Saved session with ID: {session_id}")

    # Test loading all sessions
    sessions = await manager.load_all_sessions()
    print(f"\nLoaded {len(sessions)} session(s):")
    for s in sessions:
        print(f"  - {s['title']} ({s['model']})")

    # Test loading specific session
    loaded = await manager.load_session(session_id)
    print(f"\nLoaded session content: {loaded}")


if __name__ == "__main__":
    asyncio.run(test_chat_history())
