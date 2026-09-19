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
    def test_model_and_reasoning_resolve_exact_catalog_variant(self):
        status = {'cascadeModelConfigData': {'clientModelConfigs': [
            {'label': 'Gemini 3.8 Flash (Low)', 'modelOrAlias': {'model': 'MODEL_LOW'}},
            {'label': 'Gemini 3.8 Flash (High)', 'modelOrAlias': {'model': 'MODEL_HIGH'}},
            {'label': 'Gemini 3.1 Pro (Low)', 'modelOrAlias': {'model': 'MODEL_PRO_LOW'}}
        ]}}
        self.assertEqual(bridge.resolve_model_config(status, 'flash_lite', 'low'), {'model': 'MODEL_LOW'})
        self.assertEqual(bridge.resolve_model_config(status, 'flash_lite', 'high'), {'model': 'MODEL_HIGH'})
        with self.assertRaisesRegex(ValueError, 'does not offer'):
            bridge.resolve_model_config(status, 'pro', 'medium')

    def test_resumed_conversation_sends_selected_reasoning_and_user_text(self):
        calls = []
        class Client:
            user_status = {'cascadeModelConfigData': {'clientModelConfigs': [
                {'label': 'Gemini 3.7 Flash (High)', 'modelOrAlias': {'model': 'MODEL_HIGH'}}
            ]}}
            def __init__(self, _address, _token): pass
            def call(self, method, payload): calls.append((method, payload)); return {}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(bridge, 'LocalAntigravity', Client), \
             patch.object(bridge.Path, 'home', return_value=Path(directory)), \
             patch.object(bridge, 'read_agent_response', return_value=0), \
             patch.object(bridge, 'emit'):
            args = argparse.Namespace(model='flash', reasoning='high', prompt='Hello', resume='existing-session', cwd=directory)
            self.assertEqual(asyncio.run(bridge.run_local_agent(args, 'localhost:4000', 'token')), 0)
        self.assertEqual(calls, [('SendUserCascadeMessage', {
            'cascadeId': 'existing-session', 'items': [{'text': 'Hello'}],
            'cascadeConfig': {'plannerConfig': {'requestedModel': {'model': 'MODEL_HIGH'}}}
        })])

    def test_quota_windows_keep_zero_remaining_and_reset_dates(self):
        windows = bridge.quota_windows({'response': {'groups': [{'displayName': 'Gemini Models', 'buckets': [
            {'displayName': 'Weekly', 'remainingFraction': 0.75, 'resetTime': '2026-09-24T18:00:00Z'},
            {'displayName': 'Five Hour', 'resetTime': '2026-09-19T21:00:00Z'}
        ]}]}})
        self.assertEqual([window['percent'] for window in windows], [100, 25])
        self.assertEqual(windows[0]['severity'], 'critical')
        self.assertEqual(windows[1]['resetsAt'], '2026-09-24T18:00:00Z')

    def test_rewritten_step_streams_thinking_then_full_answer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'transcript.jsonl'
            row = {'step_index': 5, 'source': 'MODEL', 'type': 'PLANNER_RESPONSE',
                   'status': 'GENERATING', 'thinking': 'Preparing a friendly answer.'}
            path.write_text(json.dumps(row) + '\n', encoding='utf-8')
            events = []
            snapshots = iter([
                {**row, 'content': 'Yes, I am here and ready to help'},
                {**row, 'status': 'DONE', 'content': 'Да, я здесь! Чем могу помочь?'}
            ])
            async def rewrite(_seconds):
                self.assertFalse(any(event['type'] == 'step-finish' for event in events))
                path.write_text(json.dumps(next(snapshots)) + '\n', encoding='utf-8')
            with patch.object(bridge, 'emit', side_effect=events.append), \
                 patch.object(bridge.asyncio, 'sleep', side_effect=rewrite):
                self.assertEqual(asyncio.run(bridge.read_agent_response(bridge.TranscriptSnapshot(Path(directory)), set(), 'Тест ты тут?', 2)), 0)
            self.assertEqual(events[0]['type'], 'reasoning')
            self.assertEqual([event['text'] for event in events if event['type'] == 'text'],
                             ['Yes, I am here and ready to help', 'Да, я здесь! Чем могу помочь?'])
            self.assertTrue(all(event['snapshot'] for event in events if event['type'] in ('text', 'reasoning')))
            self.assertEqual(events[-1]['type'], 'step-finish')

    def test_truncated_answer_waits_for_full_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            row = {'step_index': 5, 'source': 'MODEL', 'type': 'PLANNER_RESPONSE',
                   'status': 'DONE', 'content': 'Shortened...', 'truncated_fields': ['content']}
            (root / 'transcript.jsonl').write_text(json.dumps(row) + '\n', encoding='utf-8')
            events = []
            async def expand(_seconds):
                self.assertEqual(events, [])
                (root / 'transcript_full.jsonl').write_text(json.dumps({**row, 'content': 'Complete answer', 'truncated_fields': []}) + '\n', encoding='utf-8')
            with patch.object(bridge, 'emit', side_effect=events.append), \
                 patch.object(bridge.asyncio, 'sleep', side_effect=expand):
                self.assertEqual(asyncio.run(bridge.read_agent_response(bridge.TranscriptSnapshot(root), set(), 'test', 2)), 0)
            self.assertEqual(events[0]['text'], 'Complete answer')

    def test_incomplete_json_line_is_retried_and_steps_are_ordered(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            row = {'step_index': 5, 'source': 'MODEL', 'type': 'PLANNER_RESPONSE', 'status': 'DONE', 'content': 'Answer'}
            (root / 'transcript_full.jsonl').write_text(json.dumps(row) + '\n', encoding='utf-8')
            short = root / 'transcript.jsonl'
            short.write_text('{"step_index": 3, "content": "Before"}\n{"step_index": 7', encoding='utf-8')
            snapshot = bridge.TranscriptSnapshot(root)
            self.assertEqual(list(snapshot.records()), ['step:3', 'step:5'])
            short.write_text('{"step_index": 3, "content": "Before"}\n{"step_index": 7, "content": "After"}\n', encoding='utf-8')
            self.assertEqual(list(snapshot.records()), ['step:3', 'step:5', 'step:7'])

    def test_reasoning_without_answer_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'transcript.jsonl').write_text(json.dumps({'step_index': 1, 'source': 'MODEL', 'type': 'PLANNER_RESPONSE', 'thinking': 'Still thinking', 'status': 'DONE'}) + '\n', encoding='utf-8')
            events = []
            with patch.object(bridge, 'emit', side_effect=events.append):
                self.assertEqual(asyncio.run(bridge.read_agent_response(bridge.TranscriptSnapshot(root), set(), 'test', 0.05)), 1)
            self.assertEqual([event['type'] for event in events], ['reasoning', 'error'])

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
