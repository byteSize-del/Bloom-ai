"""
Offline AI Chat - Chat History Manager
Handles saving and loading chat sessions to/from JSON files.
"""
import json
import uuid
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
# from pathlib import Path # Removed as not directly used
# import asyncio # Removed as only used in test block

import os
import json
import uuid
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
# from pathlib import Path # Removed as not directly used
# import asyncio # Removed as only used in test block
class ChatHistoryManager:
    """Manages chat session persistence and history."""

    def __init__(self, data_dir: str = None, settings_file: str = None):
        # Use environment variable or default app data directory
        self.data_dir = data_dir or os.environ.get(
            "DATA_DIR",
            os.path.join(os.path.expanduser("~"), ".offline-ai-chat", "sessions")
        )
        default_settings_file = os.path.join(os.path.dirname(self.data_dir), "settings.json")
        self.settings_file = settings_file or default_settings_file
        os.makedirs(os.path.dirname(self.settings_file), exist_ok=True)
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
            "createdAt": datetime.now(timezone.utc).isoformat(),
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

    async def update_session(self, session_id: str, session_data: Dict[str, Any]) -> bool:
        """
        Update an existing chat session without changing its ID.

        Args:
            session_id: Existing session ID
            session_data: Contains title, model, and messages

        Returns:
            True if updated, False if session does not exist
        """
        filepath = os.path.join(self.data_dir, f"{session_id}.json")
        if not os.path.exists(filepath):
            return False

        existing = await self.load_session(session_id)
        if not existing:
            return False

        title = session_data.get("title")
        model = session_data.get("model", existing.get("model", "llama3"))
        messages = session_data.get("messages", existing.get("messages", []))

        if not title:
            title = await self.generate_title(messages)

        updated = {
            "id": session_id,
            "title": title,
            "model": model,
            "createdAt": existing.get("createdAt", datetime.now(timezone.utc).isoformat()),
            "messages": messages
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(updated, f, indent=2, ensure_ascii=False)

        return True

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

    async def get_usage_summary(self, token_limit: int = 200000) -> Dict[str, Any]:
        """
        Build usage summary from saved sessions.

        Args:
            token_limit: Monthly token allowance for progress calculations.

        Returns:
            Usage summary metrics.
        """
        session_count = 0
        message_count = 0
        user_message_count = 0
        assistant_message_count = 0
        character_count = 0

        try:
            for filename in os.listdir(self.data_dir):
                if not filename.endswith(".json"):
                    continue

                filepath = os.path.join(self.data_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        session = json.load(f)
                except (json.JSONDecodeError, IOError):
                    continue

                session_count += 1
                messages = session.get("messages", [])
                message_count += len(messages)

                for msg in messages:
                    role = str(msg.get("role", "")).strip().lower()
                    content = str(msg.get("content", ""))
                    character_count += len(content)
                    if role == "user":
                        user_message_count += 1
                    elif role in {"assistant", "ai", "bot", "model"}:
                        assistant_message_count += 1
        except OSError:
            pass

        estimated_tokens_used = max(0, int(round(character_count / 4)))
        safe_limit = max(1, int(token_limit))
        usage_percent = min(100.0, (estimated_tokens_used / safe_limit) * 100.0)
        remaining_tokens = max(0, safe_limit - estimated_tokens_used)

        return {
            "sessionCount": session_count,
            "messageCount": message_count,
            "userMessageCount": user_message_count,
            "assistantMessageCount": assistant_message_count,
            "characterCount": character_count,
            "estimatedTokensUsed": estimated_tokens_used,
            "tokenLimitMonthly": safe_limit,
            "remainingTokens": remaining_tokens,
            "usagePercent": round(usage_percent, 2)
        }

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
            "systemPrompt": "",
            "temperature": 0.7,
            "defaultModel": "llama3",
            "developerMode": False,
            # "agenticCloudMode": False, # Removed for simpler chatbot
            # "skills": [], # Removed for simpler chatbot
            "monthlyTokenLimit": 200000,
            # "mcpServers": [], # Removed for simpler chatbot
            "sidebarWidth": 300,
            # "toolAutomationEnabled": True, # Removed for simpler chatbot
            # "agentModeEnabled": False, # Removed for simpler chatbot
            # "strictPermissionMode": False, # Removed for simpler chatbot
            # "maxAgentLoopDepth": 5, # Removed for simpler chatbot
            # "networkToolEnabled": False, # Removed for simpler chatbot
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
    import asyncio # Re-add asyncio for the test block only
    asyncio.run(test_chat_history())

