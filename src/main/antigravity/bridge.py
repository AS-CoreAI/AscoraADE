import argparse
import asyncio
import json
import os
import re
import shutil
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
    configured = os.environ.get('ANTIGRAVITY_AGENTAPI')
    if configured and Path(configured).is_file():
        return configured
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
    candidates.extend([
        Path('/Applications/Antigravity.app/Contents/Resources/app/bin/agentapi'),
        Path('/usr/share/antigravity/resources/app/bin/agentapi'),
    ])
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which('agentapi')


def agentapi_command(executable: str, *args: str) -> list[str]:
    """The raw language server needs a subcommand; agentapi wrappers do not."""
    prefix = ['agentapi'] if Path(executable).name.lower().startswith('language_server') else []
    return [executable, *prefix, *args]


def language_servers() -> list[tuple[str, list[int]]]:
    """Keep each process's token and ports together; psutil is optional."""
    result = []
    try:
        import psutil
        for proc in psutil.process_iter(['name', 'cmdline']):
            try:
                if 'language_server' not in (proc.info.get('name') or '').lower():
                    continue
                command = ' '.join(proc.info.get('cmdline') or [])
                ports = [c.laddr.port for c in proc.net_connections(kind='tcp')
                         if c.status == psutil.CONN_LISTEN and c.laddr.port > 1024]
                result.append((command, ports))
            except (psutil.Error, OSError):
                continue
    except ImportError:
        pass
    if result or os.name != 'nt':
        return result
    # A standard Windows install does not include psutil. Discover processes
    # once and read the TCP table once, without installing Python packages.
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    try:
        processes = subprocess.run([
            'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name LIKE 'language_server%'\" | "
            'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'
        ], capture_output=True, text=True, timeout=8, creationflags=flags)
        rows = json.loads(processes.stdout or '[]')
        if isinstance(rows, dict):
            rows = [rows]
        tcp = subprocess.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True,
                             text=True, timeout=5, creationflags=flags)
        for row in rows:
            ports = []
            for line in tcp.stdout.splitlines():
                fields = line.split()
                if len(fields) >= 5 and fields[3] == 'LISTENING' and fields[4] == str(row['ProcessId']):
                    ports.append(int(fields[1].rsplit(':', 1)[1]))
            result.append((row.get('CommandLine') or '', ports))
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
        pass
    return result


def resolve_ls_credentials(agentapi_cmd: str) -> tuple[str | None, str | None]:
    """Finds active language_server address and CSRF token."""
    addr = os.environ.get('ANTIGRAVITY_LS_ADDRESS')
    token = os.environ.get('ANTIGRAVITY_CSRF_TOKEN')

    if addr and token:
        return addr, token

    servers = sorted(language_servers(), key=lambda item: 'antigravity' not in item[0].lower())
    for command, ports in servers:
        match = re.search(r'--csrf_token(?:=|\s+)["\']?([^\s"\']+)', command)
        candidate_token = token or (match.group(1) if match else None)
        if not candidate_token:
            continue
        for port in sorted(set(ports), reverse=True):
            candidate_addr = f'127.0.0.1:{port}'
            if addr and addr.rsplit(':', 1)[-1] != str(port):
                continue
            try:
                res = subprocess.run(
                    agentapi_command(agentapi_cmd, 'get-conversation-metadata', 'probe-test'),
                    env={**os.environ, 'ANTIGRAVITY_LS_ADDRESS': candidate_addr,
                         'ANTIGRAVITY_CSRF_TOKEN': candidate_token},
                    capture_output=True, text=True,
                    shell=agentapi_cmd.lower().endswith(('.bat', '.cmd')), timeout=3,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                )
                output = (res.stderr + res.stdout).lower()
                # A successful call or a semantic "trajectory not found" / "not found"
                # response proves the endpoint speaks agentapi. A refused TCP
                # connection or unknown subcommand is never a successful probe.
                if res.returncode == 0 or (
                    any(t in output for t in ('not found', 'trajectory', 'permission_denied', 'project_id', 'unauthenticated', 'csrf'))
                    and 'unavailable' not in output
                    and 'connection error' not in output
                ):
                    return candidate_addr, candidate_token
            except (OSError, subprocess.TimeoutExpired):
                continue
    return None, None

def resolve_project_id(target_cwd: str | None = None) -> str | None:
    """Finds project_id for target_cwd from env or conversation summaries."""
    if os.environ.get('ANTIGRAVITY_PROJECT_ID'):
        return os.environ['ANTIGRAVITY_PROJECT_ID']

    db_path = Path.home() / '.gemini' / 'antigravity' / 'conversation_summaries.db'
    if not db_path.exists():
        return None

    target_norm = None
    if target_cwd:
        try:
            target_norm = Path(target_cwd).resolve().as_posix().lower()
        except Exception:
            pass

    try:
        import sqlite3
        import urllib.parse
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        if target_norm:
            cursor.execute(
                'SELECT project_id, workspace_uris FROM conversation_summaries WHERE length(project_id) > 0 ORDER BY last_modified_time DESC'
            )
            for proj_id, uris_raw in cursor.fetchall():
                if not uris_raw or not uris_raw.strip():
                    continue
                try:
                    uris = json.loads(uris_raw)
                    for u in uris:
                        dec = urllib.parse.unquote(u).lower().replace('\\', '/')
                        if dec.startswith('file:///'):
                            dec = dec[8:]
                        elif dec.startswith('file://'):
                            dec = dec[7:]
                        if len(dec) >= 3 and dec[0] == '/' and dec[2] == ':':
                            dec = dec[1:]
                        if dec == target_norm or dec.startswith(target_norm) or target_norm.startswith(dec):
                            conn.close()
                            return proj_id
                except Exception:
                    continue

        cursor.execute(
            'SELECT project_id FROM conversation_summaries WHERE length(project_id) > 0 ORDER BY last_modified_time DESC LIMIT 1;'
        )
        row = cursor.fetchone()
        conn.close()
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

    cwd = os.path.abspath(args.cwd) if args.cwd and os.path.isdir(args.cwd) else os.getcwd()
    project_id = resolve_project_id(cwd)
    if project_id:
        env['ANTIGRAVITY_PROJECT_ID'] = project_id

    model = args.model or 'flash'
    prompt = args.prompt
    conv_id = args.resume

    if conv_id and not re.fullmatch(r'[A-Za-z0-9_-]+', conv_id):
        emit({'type': 'error', 'message': 'Invalid Antigravity conversation ID.'})
        return 1
    brain_dir = Path.home() / '.gemini' / 'antigravity' / 'brain'
    previous_transcript = brain_dir / conv_id / '.system_generated' / 'logs' / 'transcript.jsonl' if conv_id else None
    offset = previous_transcript.stat().st_size if previous_transcript and previous_transcript.exists() else 0
    cmd = (agentapi_command(agentapi_cmd, 'send-message', conv_id, prompt) if conv_id else
           agentapi_command(agentapi_cmd, 'new-conversation', f'--model={model}', prompt))

    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=agentapi_cmd.lower().endswith(('.bat', '.cmd')),
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    )
    try:
        stdout, stderr = proc.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        emit({'type': 'error', 'message': 'Antigravity did not accept the request within 60 seconds.'})
        return 1

    # Check if project_id mismatch occurred and auto-recover with source project_id
    combined_out = (stdout + ' ' + stderr).strip()
    mismatch = re.search(r'source project_id ["\']([^"\']+)["\']', combined_out)
    if mismatch and mismatch.group(1) != env.get('ANTIGRAVITY_PROJECT_ID'):
        env['ANTIGRAVITY_PROJECT_ID'] = mismatch.group(1)
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=agentapi_cmd.lower().endswith(('.bat', '.cmd')),
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        try:
            stdout, stderr = proc.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            emit({'type': 'error', 'message': 'Antigravity did not accept the request within 60 seconds.'})
            return 1

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

    if isinstance(resp_data, dict) and resp_data.get('error'):
        emit({'type': 'error', 'message': str(resp_data['error'])})
        return 1

    response = resp_data.get('response') or {} if isinstance(resp_data, dict) else {}
    actual_conv_id = (conv_id or (response.get('newConversation') or {}).get('conversationId')
                      or (response.get('sendMessage') or {}).get('recipientId'))

    if actual_conv_id:
        emit({'type': 'session', 'sessionID': actual_conv_id})

    if not actual_conv_id or not re.fullmatch(r'[A-Za-z0-9_-]+', actual_conv_id):
        emit({'type': 'error', 'message': 'Antigravity returned no valid conversation ID.'})
        return 1
    transcript_file = brain_dir / actual_conv_id / '.system_generated' / 'logs' / 'transcript.jsonl'
    deadline = time.monotonic() + 180
    response_content = ''
    thinking_content = ''
    tools_seen = set()
    while time.monotonic() < deadline:
        if transcript_file.exists():
            try:
                with transcript_file.open('rb') as transcript:
                    if transcript_file.stat().st_size < offset:
                        offset = 0
                    transcript.seek(offset)
                    while True:
                        line = transcript.readline()
                        if not line or not line.endswith(b'\n'):
                            break
                        offset = transcript.tell()
                        try:
                            record = json.loads(line)
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if record.get('source') != 'MODEL' or record.get('type') != 'PLANNER_RESPONSE':
                            continue
                        thinking = record.get('thinking')
                        content = record.get('content')
                        tool_calls = record.get('tool_calls') or []
                        if isinstance(thinking, str) and thinking and thinking != thinking_content:
                            thinking_content = thinking
                            emit({'type': 'reasoning', 'text': thinking})
                        for tool in tool_calls:
                            tool_id = tool.get('id') or json.dumps(tool, sort_keys=True)
                            if tool_id in tools_seen:
                                continue
                            tools_seen.add(tool_id)
                            emit({'type': 'tool', 'tool': tool.get('name', 'tool'), 'callID': tool_id,
                                  'state': {'status': 'running', 'input': tool.get('args', {})}})
                        if isinstance(content, str) and content:
                            response_content += content
                            emit({'type': 'text', 'text': response_content})
                            if not tool_calls:
                                emit({'type': 'step-finish', 'tokens': {
                                    'input': len(prompt) // 4, 'output': len(response_content) // 4}})
                                return 0
            except OSError:
                pass
        await asyncio.sleep(0.2)
    emit({'type': 'error', 'message': 'Antigravity accepted the request but no completed response arrived within 180 seconds. Check the active conversation in Antigravity.'})
    return 1


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
        if has_api_key:
            return await run_sdk(args)
        if find_agentapi():
            return await run_agentapi(args)
        emit({'type': 'error', 'message': 'Antigravity is not installed. Install and sign in to Antigravity, then start its language server.'})
        return 1
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        emit({'type': 'error', 'message': str(exc)})
        print(traceback.format_exc(), file=sys.stderr)
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description='Antigravity bridge')
    parser.add_argument('--check', action='store_true', help='Check the local language server')
    parser.add_argument('--prompt', help='The user prompt')
    parser.add_argument('--cwd', default='.', help='Working directory')
    parser.add_argument('--model', choices=['flash_lite', 'flash', 'pro'], default=None,
                        help='Model tier to use')
    parser.add_argument('--resume', default=None, help='Conversation ID to resume')
    parser.add_argument('--api-key', default=None, help='Gemini API key override')
    args = parser.parse_args()
    if args.check:
        executable = find_agentapi()
        address, token = resolve_ls_credentials(executable) if executable else (None, None)
        emit({'ok': True, 'installed': bool(executable), 'loggedIn': bool(address and token),
              'connected': bool(address and token),
              'authNote': 'Local Antigravity connection verified. Account sign-in is managed in Antigravity.' if address and token else
                          'Start Antigravity, open a project and sign in. The local language server is not reachable.'})
        return
    if not args.prompt:
        parser.error('--prompt is required unless --check is used')
    sys.exit(asyncio.run(run(args)))


if __name__ == '__main__':
    main()
