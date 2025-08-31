from __future__ import annotations

from typing import Any

from langchain_openai import ChatOpenAI

from src.utils.settings import get_settings


class LLMExpenseParser:
    def __init__(self, model: str = "gpt-4o-mini"):
        settings = get_settings()
        self.llm = ChatOpenAI(model=model, temperature=0.1, api_key=settings.OPENAI_API_KEY)

    async def parse_text_to_expenses(self, text: str) -> list[dict[str, Any]]:
        # TODO: Implement structured output via LC OutputParser
        # Minimal stub returning empty list
        return []


