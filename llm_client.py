"""
llm_client.py — Unified LLM client supporting Gemini (free) and Anthropic.
Reads LLM_PROVIDER from .env to decide which to use.
"""

import os
from dotenv import load_dotenv

load_dotenv()

PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()


def call_llm(prompt: str, max_tokens: int = 1024) -> str:
    """
    Single unified function to call whichever LLM is configured.
    Returns the model's text response as a plain string.
    """
    if PROVIDER == "gemini":
        return _call_gemini(prompt, max_tokens)
    elif PROVIDER == "anthropic":
        return _call_anthropic(prompt, max_tokens)
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {PROVIDER}. Use 'gemini' or 'anthropic'.")


def _call_gemini(prompt: str, max_tokens: int) -> str:
    """Google Gemini 2.0 Flash — completely free tier."""
    import google.generativeai as genai

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash-lite",
        generation_config={"temperature": 0.2},
    )
    response = model.generate_content(prompt)
    return response.text.strip()


def _call_anthropic(prompt: str, max_tokens: int) -> str:
    """Anthropic Claude Haiku — cheapest Claude model ($5 free credit)."""
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()
