import argparse
import asyncio
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
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


class LocalAntigravity:
    """Use the same local Connect JSON API as Antigravity's model selector."""
    service = '/exa.language_server_pb.LanguageServerService/'

    def __init__(self, address: str, token: str):
        parsed = urllib.parse.urlsplit(f'http://{address}')
        if parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or not parsed.port:
            raise ValueError('Antigravity must expose a local language server.')
        self.address = address
        self.token = token
        self.base_url = f'http://{address}'
        try:
            self.user_status = self.call('GetUserStatus', {}).get('userStatus', {})
        except (urllib.error.URLError, ConnectionError):
            self.base_url = f'https://{address}'
            self.user_status = self.call('GetUserStatus', {}).get('userStatus', {})

    def call(self, method: str, payload: dict) -> dict:
        request = urllib.request.Request(self.base_url + self.service + method,
            data=json.dumps(payload).encode('utf-8'), headers={
                'Content-Type': 'application/json', 'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': self.token
            })
        # Local Antigravity uses its own certificate. Never use this context
        # with remote addresses (the constructor restricts the endpoint).
        context = ssl._create_unverified_context() if self.base_url.startswith('https:') else None
        try:
            with urllib.request.urlopen(request, timeout=15, context=context) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read(8192)).get('message')
            except (ValueError, AttributeError):
                message = None
            raise RuntimeError(message or f'Antigravity {method} failed (HTTP {error.code}).') from error
        if not isinstance(data, dict):
            raise RuntimeError(f'Antigravity {method} returned an invalid response.')
        return data


MODEL_LABELS = {
    'flash_lite': 'Gemini 3.8 Flash', 'flash': 'Gemini 3.7 Flash',
    'flash_36': 'Gemini 3.6 Flash', 'pro': 'Gemini 3.1 Pro',
    'claude_sonnet': 'Claude Sonnet 4.6', 'claude_opus': 'Claude Opus 4.6',
    'gpt_oss': 'GPT-OSS 120B'
}


def resolve_model_config(status: dict, model: str, reasoning: str | None) -> dict:
    label = MODEL_LABELS.get(model, model)
    if model in ('flash_lite', 'flash', 'flash_36', 'pro'):
        label += f' ({(reasoning or ("high" if model == "pro" else "medium")).title()})'
    else:
        label += ' (Medium)' if model == 'gpt_oss' else ' (Thinking)' if model.startswith('claude_') else ''
    for config in status.get('cascadeModelConfigData', {}).get('clientModelConfigs', []):
        if config.get('label', '').casefold() == label.casefold() and not config.get('disabled'):
            if config.get('modelOrAlias'):
                return config['modelOrAlias']
    raise ValueError(f'Antigravity does not offer {label} for this account. Choose an available model or reasoning level.')


def quota_windows(summary: dict) -> list[dict]:
    windows = []
    for group in summary.get('response', {}).get('groups', []):
        for bucket in group.get('buckets', []):
            fraction = bucket.get('remainingFraction', 0)
            if not isinstance(fraction, (int, float)) or not 0 <= fraction <= 1:
                continue
            percent = round((1 - fraction) * 100)
            windows.append({'label': f'{group.get("displayName", "Antigravity")} · {bucket.get("displayName", "Usage")}',
                            'percent': percent, 'severity': 'critical' if percent >= 90 else 'warning' if percent >= 75 else 'normal',
                            **({'resetsAt': bucket['resetTime']} if bucket.get('resetTime') else {})})
    return sorted(windows, key=lambda window: window['percent'], reverse=True)


def read_usage() -> dict:
    executable = find_agentapi()
    address, token = resolve_ls_credentials(executable) if executable else (None, None)
    if not address or not token:
        return {'ok': False, 'loggedIn': False, 'windows': [], 'error': 'Start Antigravity and sign in to read its limits.'}
    client = LocalAntigravity(address, token)
    windows = quota_windows(client.call('RetrieveUserQuotaSummary', {'forceRefresh': True}))
    return {'ok': True, 'loggedIn': True, 'windows': windows, **({'headline': windows[0]} if windows else {})}


class TranscriptSnapshot:
    """Antigravity rewrites existing steps while streaming; byte offsets lose updates."""
    def __init__(self, directory: Path):
        self.directory = directory
        self.cache = {}

    def _read(self, name: str) -> list[dict]:
        path = self.directory / name
        try:
            stat = path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
            cached = self.cache.get(name)
            if cached and cached[0] == stamp:
                return cached[1]
            records = []
            for line in path.read_bytes().splitlines():
                try:
                    record = json.loads(line)
                    if isinstance(record, dict):
                        records.append(record)
                except (ValueError, UnicodeDecodeError):
                    # A write may be in progress. Retry the complete snapshot
                    # on the next modification, including the unfinished row.
                    continue
            self.cache[name] = (stamp, records)
            return records
        except OSError:
            return self.cache.get(name, (None, []))[1]

    @staticmethod
    def key(record: dict, index: int) -> str:
        step = record.get('step_index')
        return f'step:{step}' if step is not None else f'row:{index}'

    def records(self) -> dict[str, dict]:
        full = {self.key(r, i): r for i, r in enumerate(self._read('transcript_full.jsonl'))}
        records = dict(full)
        for index, short in enumerate(self._read('transcript.jsonl')):
            key = self.key(short, index)
            record = dict(short)
            expanded = full.get(key, {})
            truncated = short.get('truncated_fields') or []
            for field in ('content', 'thinking', 'tool_calls'):
                if field in truncated:
                    # Never return a shortened answer as the completed result.
                    record.pop(field, None)
                    if field in expanded:
                        record[field] = expanded[field]
                elif field not in short and field in expanded:
                    record[field] = expanded[field]
                    if field == 'content' and expanded.get('status') == 'DONE':
                        record['status'] = 'DONE'
            records[key] = record
        def step_order(item):
            try:
                return int(item[0].partition(':')[2])
            except (TypeError, ValueError):
                return 0
        return dict(sorted(records.items(), key=step_order))


async def read_agent_response(snapshot: TranscriptSnapshot, previous_steps: set[str], prompt: str,
                              timeout: float = 180) -> int:
    deadline = time.monotonic() + timeout
    text_by_step = {}
    thinking_by_step = {}
    last_text = ''
    last_thinking = ''
    tools_seen = set()
    while time.monotonic() < deadline:
        completed = False
        for key, record in snapshot.records().items():
            if key in previous_steps or record.get('source') != 'MODEL' or record.get('type') != 'PLANNER_RESPONSE':
                continue
            thinking = record.get('thinking')
            content = record.get('content')
            tool_calls = record.get('tool_calls') or []
            if isinstance(thinking, str) and thinking:
                thinking_by_step[key] = thinking
            if isinstance(content, str) and content:
                text_by_step[key] = content
                # Some older versions omit status on their final snapshot.
                completed = not tool_calls and record.get('status', 'DONE') in ('DONE', 'COMPLETED')
            else:
                completed = False
            for tool in tool_calls:
                if not isinstance(tool, dict):
                    continue
                tool_id = tool.get('id') or f'{key}:{json.dumps(tool, sort_keys=True)}'
                if tool_id in tools_seen:
                    continue
                tools_seen.add(tool_id)
                emit({'type': 'tool', 'tool': tool.get('name', 'tool'), 'callID': tool_id,
                      'state': {'status': 'running', 'input': tool.get('args', {})}})
        thinking = '\n\n'.join(thinking_by_step.values())
        text = '\n\n'.join(text_by_step.values())
        if thinking and thinking != last_thinking:
            last_thinking = thinking
            emit({'type': 'reasoning', 'text': thinking, 'snapshot': True})
        if text and text != last_text:
            last_text = text
            emit({'type': 'text', 'text': text, 'snapshot': True})
        if completed and text:
            emit({'type': 'step-finish', 'tokens': {'input': len(prompt) // 4, 'output': len(text) // 4}})
            return 0
        await asyncio.sleep(0.2)
    emit({'type': 'error', 'message': f'Antigravity has not completed its answer within {timeout:g} seconds. Check the active conversation in Antigravity and retry.'})
    return 1


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

    # The agentapi convenience command accepts only model tiers and cannot
    # change effort on a resumed conversation. Send the exact catalog variant
    # through the local UI API when the caller provides an explicit selection.
    if getattr(args, 'reasoning', None) or args.model not in (None, 'flash_lite', 'flash', 'pro'):
        return await run_local_agent(args, addr, token or '')

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
    snapshot = TranscriptSnapshot(brain_dir / conv_id / '.system_generated' / 'logs') if conv_id else None
    previous_steps = set(snapshot.records()) if snapshot else set()
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
    snapshot = snapshot if actual_conv_id == conv_id else TranscriptSnapshot(brain_dir / actual_conv_id / '.system_generated' / 'logs')
    return await read_agent_response(snapshot, previous_steps, prompt)


async def run_local_agent(args: argparse.Namespace, address: str, token: str) -> int:
    client = LocalAntigravity(address, token)
    requested_model = resolve_model_config(client.user_status, args.model or 'flash', getattr(args, 'reasoning', None))
    conversation = args.resume
    if conversation and not re.fullmatch(r'[A-Za-z0-9_-]+', conversation):
        raise ValueError('Invalid Antigravity conversation ID.')
    if not conversation:
        cwd = Path(args.cwd or '.').resolve()
        if not cwd.is_dir():
            raise ValueError('The Antigravity workspace directory does not exist.')
        payload = {'cascadeId': str(uuid.uuid4()), 'workspaceUris': [cwd.as_uri()],
                   'overrideWorkspaceUris': [cwd.as_uri()],
                   'source': 'CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT'}
        if 'model' in requested_model:
            payload['requestedModel'] = requested_model['model']
        conversation = client.call('StartCascade', payload).get('cascadeId')
        if not conversation or not re.fullmatch(r'[A-Za-z0-9_-]+', conversation):
            raise ValueError('Antigravity returned no valid conversation ID.')
    emit({'type': 'session', 'sessionID': conversation})
    snapshot = TranscriptSnapshot(Path.home() / '.gemini/antigravity/brain' / conversation / '.system_generated/logs')
    previous_steps = set(snapshot.records())
    client.call('SendUserCascadeMessage', {'cascadeId': conversation, 'items': [{'text': args.prompt}],
                'cascadeConfig': {'plannerConfig': {'requestedModel': requested_model}}})
    return await read_agent_response(snapshot, previous_steps, args.prompt)


async def run_sdk(args: argparse.Namespace) -> int:
    try:
        from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
    except ImportError:
        emit({'type': 'error', 'message': 'google-antigravity SDK is not installed. Run: pip install google-antigravity'})
        return 1

    api_key = args.api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    model_name = args.model
    MODEL_MAP = {
        'flash_lite': 'gemini-3.8-flash',
        'flash': 'gemini-3.7-flash',
        'flash_36': 'gemini-3.6-flash',
        'pro': 'gemini-3.1-pro',
        'claude_sonnet': 'claude-sonnet-4-6',
        'claude_opus': 'claude-opus-4-6',
        'gpt_oss': 'gpt-oss-120b',
    }
    model_target = MODEL_MAP.get(model_name, model_name)

    config_kwargs = {
        'system_instructions': 'You are an expert coding assistant in Ascora ADE. Help the user analyze, write, and debug code.',
        'capabilities': CapabilitiesConfig(),
        'api_key': api_key,
    }
    if model_target:
        config_kwargs['model'] = model_target
    if getattr(args, 'reasoning', None) and model_target.startswith('gemini-'):
        from google.antigravity.models import ModelTarget, GeminiAPIEndpoint, GeminiModelOptions, ThinkingLevel
        config_kwargs['model'] = ModelTarget(name=model_target, endpoint=GeminiAPIEndpoint(
            api_key=api_key, options=GeminiModelOptions(thinking_level=ThinkingLevel(args.reasoning))))

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
    parser.add_argument('--usage', action='store_true', help='Read account quotas from the local language server')
    parser.add_argument('--prompt', help='The user prompt')
    parser.add_argument('--cwd', default='.', help='Working directory')
    parser.add_argument('--model', default=None,
                        help='Model tier to use')
    parser.add_argument('--resume', default=None, help='Conversation ID to resume')
    parser.add_argument('--reasoning', choices=['low', 'medium', 'high'], help='Gemini reasoning level')
    parser.add_argument('--api-key', default=None, help='Gemini API key override')
    args = parser.parse_args()
    if args.usage:
        try:
            emit(read_usage())
        except Exception as error:
            emit({'ok': False, 'loggedIn': True, 'windows': [], 'error': str(error)})
        return
    if args.check:
        executable = find_agentapi()
        address, token = resolve_ls_credentials(executable) if executable else (None, None)
        signed_in = False
        error = None
        if address and token:
            try:
                status = LocalAntigravity(address, token).user_status
                signed_in = bool(status.get('email') or status.get('name'))
            except Exception as exc:
                error = str(exc)
        emit({'ok': error is None, 'installed': bool(executable), 'loggedIn': signed_in,
              'connected': bool(address and token and not error),
              **({'error': error} if error else {}),
              'authNote': 'Local Antigravity account verified.' if signed_in else
                          'Start Antigravity, open a project and sign in.'})
        return
    if not args.prompt:
        parser.error('--prompt is required unless --check is used')
    sys.exit(asyncio.run(run(args)))


if __name__ == '__main__':
    main()
