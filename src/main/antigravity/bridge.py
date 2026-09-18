#!/usr/bin/env python3
"""Antigravity SDK bridge for Ascora ADE.

Streams agent responses as newline-delimited JSON events on stdout,
matching the ZCode/Codex normalized event shape so the renderer can
reuse the same CLI-backend code path.

Usage:
  python bridge.py --prompt "..." --cwd /path [--model flash] [--resume conv_id]
"""
import argparse
import asyncio
import json
import os
import sys
import traceback


def emit(obj: dict) -> None:
    """Write one NDJSON line to stdout and flush."""
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
        sys.stdout.flush()
    except BrokenPipeError:
        sys.exit(0)


async def run(args: argparse.Namespace) -> int:
    try:
        from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
    except ImportError:
        emit({"type": "error", "message": "google-antigravity SDK is not installed. Run: pip install google-antigravity"})
        return 1

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        emit({
            "type": "error",
            "message": "Antigravity SDK requires a Gemini API key. Please set GEMINI_API_KEY in your environment or launch Ascora with GEMINI_API_KEY=<your-key>."
        })
        return 1

    try:
        # Map friendly model names if necessary
        model_name = args.model
        if model_name == "flash_lite":
            model_target = "gemini-2.0-flash-lite"
        elif model_name == "flash":
            model_target = "gemini-2.0-flash"
        elif model_name == "pro":
            model_target = "gemini-2.5-pro"
        else:
            model_target = model_name

        config_kwargs = {
            "system_instructions": "You are an expert coding assistant in Ascora ADE. Help the user analyze, write, and debug code.",
            "capabilities": CapabilitiesConfig(),
            "api_key": api_key,
        }
        if model_target:
            config_kwargs["model"] = model_target

        config = LocalAgentConfig(**config_kwargs)

        # Set working directory
        if args.cwd and os.path.isdir(args.cwd):
            os.chdir(args.cwd)

        async with Agent(config) as agent:
            # Emit session info
            session_id = args.resume or f"agy_{id(agent)}"
            emit({"type": "session", "sessionID": session_id})

            # Send the prompt
            response = await agent.chat(args.prompt)

            text_acc = ""

            # Stream content tokens
            async for token in response:
                text_acc += token
                emit({"type": "text", "text": text_acc})

            # Emit final step-finish with usage
            emit({"type": "step-finish", "tokens": {"input": len(args.prompt) // 4, "output": len(text_acc) // 4}})

        return 0

    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        print(traceback.format_exc(), file=sys.stderr)
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Antigravity SDK bridge")
    parser.add_argument("--prompt", required=True, help="The user prompt")
    parser.add_argument("--cwd", default=".", help="Working directory")
    parser.add_argument("--model", choices=["flash_lite", "flash", "pro"], default=None,
                        help="Model tier to use")
    parser.add_argument("--resume", default=None, help="Conversation ID to resume")
    parser.add_argument("--api-key", default=None, help="Gemini API key override")
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()

