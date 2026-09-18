import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path


def emit(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
        sys.stdout.flush()
    except BrokenPipeError:
        sys.exit(0)


def find_agentapi() -> str | None:
    home = Path.home()
    candidates = [
        home / '.gemini' / 'antigravity' / 'bin' / 'agentapi.bat',
        home / '.gemini' / 'antigravity' / 'bin' / 'agentapi',
    ]
    local_app_data = os.environ.get('LOCALAPPDATA')
    if local_app_data:
        candidates.append(
            Path(local_app_data) / 'Programs' / 'antigravity' / 'resources' / 'bin' / 'language_server.exe'
        )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def resolve_ls_credentials(agentapi_cmd: str) -> tuple[str | None, str | None]:
    """Finds active language_server address and CSRF token."""
    addr = os.environ.get('ANTIGRAVITY_LS_ADDRESS')
    token = os.environ.get('ANTIGRAVITY_CSRF_TOKEN')

    if addr and token:
        return addr, token

    try:
        import psutil
        import re
        hub_ports = []
        other_ports = []
        found_token = None

        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                name = (proc.info.get('name') or '').lower()
                if 'language_server' in name:
                    cmd_list = proc.info.get('cmdline') or []
                    cmd = ' '.join(cmd_list)
                    is_hub = '--subclient_type hub' in cmd or 'antigravity' in cmd
                    
                    if not found_token:
                        m = re.search(r'--csrf_token(?:=|\s+)([^\s]+)', cmd)
                        if m:
                            found_token = m.group(1)

                    pid = proc.info['pid']
                    for conn in psutil.net_connections():
                        if conn.pid == pid and conn.status == 'LISTEN' and conn.laddr.port > 1024:
                            if is_hub:
                                hub_ports.append(conn.laddr.port)
                            else:
                                other_ports.append(conn.laddr.port)
            except Exception:
                continue

        final_token = token or found_token
        candidate_ports = hub_ports or other_ports
        for p in sorted(set(candidate_ports), reverse=True):
            test_env = os.environ.copy()
            test_env['ANTIGRAVITY_LS_ADDRESS'] = f'localhost:{p}'
            if final_token:
                test_env['ANTIGRAVITY_CSRF_TOKEN'] = final_token

            res = subprocess.run(
                [agentapi_cmd, 'get-conversation-metadata', 'probe-test'],
                env=test_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                shell=agentapi_cmd.lower().endswith('.bat'),
                timeout=3
            )
            out = res.stderr + res.stdout
            if 'ANTIGRAVITY_LS_ADDRESS is not set' not in out:
                return f'localhost:{p}', final_token
    except Exception:
        pass

def resolve_project_id() -> str | None:
    """Finds current/recent active project_id from env or conversation summaries."""
    if os.environ.get('ANTIGRAVITY_PROJECT_ID'):
        return os.environ['ANTIGRAVITY_PROJECT_ID']

    db_path = Path.home() / '.gemini' / 'antigravity' / 'conversation_summaries.db'
    if db_path.exists():
        try:
            import sqlite3
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()
            cursor.execute(
                'SELECT project_id FROM conversation_summaries WHERE length(project_id) > 0 ORDER BY last_modified_time DESC LIMIT 1;'
            )
            row = cursor.fetchone()
            if row and row[0]:
                return row[0]
        except Exception:
            pass

    return None


async def run_agentapi(args: argparse.Namespace) -> int:
    agentapi_cmd = find_agentapi()
    if not agentapi_cmd:
        emit({'type': 'error', 'message': 'Antigravity CLI (agentapi) not found.'})
        return 1

    env = os.environ.copy()
    addr, token = resolve_ls_credentials(agentapi_cmd)
    if addr:
        env['ANTIGRAVITY_LS_ADDRESS'] = addr
    else:
        emit({'type': 'error', 'message': 'Antigravity language_server port not found. Please ensure Antigravity is running.'})
        return 1

    if token:
        env['ANTIGRAVITY_CSRF_TOKEN'] = token

    project_id = resolve_project_id()
    if project_id:
        env['ANTIGRAVITY_PROJECT_ID'] = project_id

    model = args.model or 'flash'
    prompt = args.prompt
    conv_id = args.resume

    is_raw_ls = agentapi_cmd.lower().endswith('language_server.exe')

    if conv_id:
        cmd = [agentapi_cmd, 'agentapi', 'send-message', conv_id, prompt] if is_raw_ls else [agentapi_cmd, 'send-message', conv_id, prompt]
    else:
        cmd = [agentapi_cmd, 'agentapi', 'new-conversation', f'--model={model}', prompt] if is_raw_ls else [agentapi_cmd, 'new-conversation', f'--model={model}', prompt]

    cwd = args.cwd if args.cwd and os.path.isdir(args.cwd) else '.'

    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=agentapi_cmd.lower().endswith('.bat')
    )
    stdout, stderr = proc.communicate()

    if proc.returncode != 0:
        err_msg = stderr.strip() or stdout.strip() or f'agentapi exited with code {proc.returncode}'
        emit({'type': 'error', 'message': err_msg})
        return proc.returncode

    try:
        resp_data = json.loads(stdout)
    except Exception:
        emit({'type': 'text', 'text': stdout})
        emit({'type': 'step-finish', 'tokens': {'input': 0, 'output': len(stdout)}})
        return 0

    actual_conv_id = (
        conv_id
        or resp_data.get('response', {}).get('newConversation', {}).get('conversationId')
        or resp_data.get('response', {}).get('sendMessage', {}).get('recipientId')
    )

    if actual_conv_id:
        emit({'type': 'session', 'sessionID': actual_conv_id})

    brain_dir = Path.home() / '.gemini' / 'antigravity' / 'brain'
    transcript_file = brain_dir / actual_conv_id / '.system_generated' / 'logs' / 'transcript.jsonl' if actual_conv_id else None

    max_wait = 40
    start_time = time.time()
    response_content = ''
    thinking_content = ''

    if transcript_file:
        while time.time() - start_time < max_wait:
            if transcript_file.exists():
                try:
                    with open(transcript_file, 'r', encoding='utf-8') as f:
                        lines = [line.strip() for line in f if line.strip()]
                    
                    found_model = False
                    for line in reversed(lines):
                        try:
                            record = json.loads(line)
                            if record.get('source') == 'MODEL' and record.get('type') == 'PLANNER_RESPONSE':
                                thinking = record.get('thinking')
                                content = record.get('content')
                                tool_calls = record.get('tool_calls')
                                
                                if thinking and thinking != thinking_content:
                                    thinking_content = thinking
                                    emit({'type': 'reasoning', 'text': thinking_content})
                                
                                if tool_calls:
                                    for tc in tool_calls:
                                        emit({
                                            'type': 'tool',
                                            'tool': tc.get('name', 'tool'),
                                            'callID': tc.get('id', f'call_{int(time.time())}'),
                                            'state': {
                                                'status': 'completed',
                                                'input': tc.get('args', {}),
                                                'output': ''
                                            }
                                        })
                                
                                if content:
                                    response_content = content
                                    found_model = True
                                    break
                        except Exception:
                            continue
                    
                    if found_model and response_content:
                        break
                except Exception:
                    pass
            await asyncio.sleep(0.3)

    if response_content:
        chunk_size = 20
        acc = ''
        for i in range(0, len(response_content), chunk_size):
            chunk = response_content[i:i+chunk_size]
            acc += chunk
            emit({'type': 'text', 'text': acc})
            await asyncio.sleep(0.01)
    else:
        emit({'type': 'text', 'text': stdout})

    emit({
        'type': 'step-finish',
        'tokens': {
            'input': len(prompt) // 4,
            'output': len(response_content or stdout) // 4
        }
    })
    return 0


async def run_sdk(args: argparse.Namespace) -> int:
    try:
        from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
    except ImportError:
        emit({'type': 'error', 'message': 'google-antigravity SDK is not installed. Run: pip install google-antigravity'})
        return 1

    api_key = args.api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    model_name = args.model
    if model_name == 'flash_lite':
        model_target = 'gemini-2.0-flash-lite'
    elif model_name == 'flash':
        model_target = 'gemini-2.0-flash'
    elif model_name == 'pro':
        model_target = 'gemini-2.5-pro'
    else:
        model_target = model_name

    config_kwargs = {
        'system_instructions': 'You are an expert coding assistant in Ascora ADE. Help the user analyze, write, and debug code.',
        'capabilities': CapabilitiesConfig(),
        'api_key': api_key,
    }
    if model_target:
        config_kwargs['model'] = model_target

    config = LocalAgentConfig(**config_kwargs)

    if args.cwd and os.path.isdir(args.cwd):
        os.chdir(args.cwd)

    async with Agent(config) as agent:
        session_id = args.resume or f'agy_{id(agent)}'
        emit({'type': 'session', 'sessionID': session_id})
        response = await agent.chat(args.prompt)
        text_acc = ''
        async for token in response:
            text_acc += token
            emit({'type': 'text', 'text': text_acc})

        emit({'type': 'step-finish', 'tokens': {'input': len(args.prompt) // 4, 'output': len(text_acc) // 4}})

    return 0


async def run(args: argparse.Namespace) -> int:
    try:
        has_api_key = bool(args.api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'))
        creds_file = Path.home() / '.gemini' / 'oauth_creds.json'
        has_subscription = creds_file.is_file()

        if has_subscription and not has_api_key:
            return await run_agentapi(args)
        elif has_api_key:
            return await run_sdk(args)
        elif has_subscription:
            return await run_agentapi(args)
        else:
            emit({
                'type': 'error',
                'message': 'Neither Antigravity authorization nor GEMINI_API_KEY found. Please authorize in Antigravity or provide an API key.'
            })
            return 1
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        emit({'type': 'error', 'message': str(exc)})
        print(traceback.format_exc(), file=sys.stderr)
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description='Antigravity bridge')
    parser.add_argument('--prompt', required=True, help='The user prompt')
    parser.add_argument('--cwd', default='.', help='Working directory')
    parser.add_argument('--model', choices=['flash_lite', 'flash', 'pro'], default=None,
                        help='Model tier to use')
    parser.add_argument('--resume', default=None, help='Conversation ID to resume')
    parser.add_argument('--api-key', default=None, help='Gemini API key override')
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args)))


if __name__ == '__main__':
    main()
