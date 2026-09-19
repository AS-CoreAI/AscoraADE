"""Regression checks without a running Antigravity instance or account."""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'src/main/antigravity/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_missing_server_always_returns_pair(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(bridge, 'language_servers', return_value=[]):
            self.assertEqual(bridge.resolve_ls_credentials('agentapi'), (None, None))

    def test_raw_binary_receives_agentapi_subcommand(self):
        self.assertEqual(bridge.agentapi_command('language_server.exe', 'send-message', 'id', 'hello'),
                         ['language_server.exe', 'agentapi', 'send-message', 'id', 'hello'])
        self.assertEqual(bridge.agentapi_command('agentapi.bat', 'send-message'), ['agentapi.bat', 'send-message'])

    def test_failed_probe_is_not_a_connection(self):
        failure = subprocess.CompletedProcess([], 1, '', 'connection refused')
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(bridge, 'language_servers', return_value=[('--csrf_token token', [4567])]), \
             patch.object(bridge.subprocess, 'run', return_value=failure):
            self.assertEqual(bridge.resolve_ls_credentials('language_server.exe'), (None, None))

    def test_tokens_stay_with_their_own_process(self):
        seen = []
        def probe(command, **kwargs):
            seen.append((kwargs['env']['ANTIGRAVITY_LS_ADDRESS'], kwargs['env']['ANTIGRAVITY_CSRF_TOKEN']))
            return subprocess.CompletedProcess(command, 0 if len(seen) == 2 else 1, '', '')
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(bridge, 'language_servers', return_value=[('--csrf_token first', [4001]), ('--csrf_token second', [4002])]), \
             patch.object(bridge.subprocess, 'run', side_effect=probe):
            self.assertEqual(bridge.resolve_ls_credentials('language_server.exe'), ('127.0.0.1:4002', 'second'))
            self.assertEqual(seen, [('127.0.0.1:4001', 'first'), ('127.0.0.1:4002', 'second')])

    def test_no_server_emits_actionable_error_instead_of_traceback(self):
        events = []
        with patch.object(bridge, 'find_agentapi', return_value='agentapi'), \
             patch.object(bridge, 'resolve_ls_credentials', return_value=(None, None)), \
             patch.object(bridge, 'emit', side_effect=events.append):
            code = asyncio.run(bridge.run_agentapi(argparse.Namespace()))
        self.assertEqual(code, 1)
        self.assertIn('ensure Antigravity is running', events[0]['message'])

    def test_resume_reads_new_response_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript = root / '.gemini/antigravity/brain/test-session/.system_generated/logs/transcript.jsonl'
            transcript.parent.mkdir(parents=True)
            def record(content):
                return json.dumps({'source': 'MODEL', 'type': 'PLANNER_RESPONSE', 'content': content}) + '\n'
            transcript.write_text(record('old response'), encoding='utf-8')
            class Process:
                returncode = 0
                def communicate(self, timeout):
                    with transcript.open('a', encoding='utf-8') as stream:
                        stream.write(record('new response'))
                    return '{}', ''
            events = []
            args = argparse.Namespace(model='flash', prompt='next question', resume='test-session', cwd=directory)
            with patch.object(bridge.Path, 'home', return_value=root), \
                 patch.object(bridge, 'find_agentapi', return_value='agentapi'), \
                 patch.object(bridge, 'resolve_ls_credentials', return_value=('localhost:4000', 'token')), \
                 patch.object(bridge, 'resolve_project_id', return_value=None), \
                 patch.object(bridge.subprocess, 'Popen', return_value=Process()), \
                 patch.object(bridge, 'emit', side_effect=events.append):
                self.assertEqual(asyncio.run(bridge.run_agentapi(args)), 0)
            self.assertEqual([event['text'] for event in events if event['type'] == 'text'], ['new response'])
            self.assertEqual(events[0], {'type': 'session', 'sessionID': 'test-session'})


if __name__ == '__main__':
    unittest.main()
