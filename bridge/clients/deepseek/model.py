"""Display projections of native Harness records. Never modify model input/history."""
import json
import re


def _text(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    return '\n'.join(str(block.get('text') or block.get('thinking') or
                         ('[图片]' if block.get('type') == 'image' else ''))
                     for block in content if isinstance(block, dict))


def _clean(value, limit=4096):
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()[:limit] if isinstance(value, str) else ''


def _command(value):
    value = _clean(value)
    value = re.sub(r'''(?i)(--(?:api[-_]?key|access[-_]?token|token|password|secret)(?:=|\s+))("[^"]*"|'[^']*'|\S+)''',
                   lambda match: match[1] + '<redacted>', value)
    return re.sub(r'''(?i)\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET)=)("[^"]*"|'[^']*'|\S+)''',
                  lambda match: match[1] + '<redacted>', value)


def _action(data):
    name = data.get('name') or data.get('toolName') or '工具'
    arguments = data.get('arguments') or {}
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except ValueError:
            arguments = {}
    if not isinstance(arguments, dict):
        arguments = {}
    tool = str(name).lower().replace('-', '_').rsplit('/', 1)[-1]
    target = _clean(arguments.get('path') or arguments.get('file_path') or arguments.get('file') or arguments.get('directory'), 512)
    if tool in ('bash', 'shell', 'exec_command', 'execute', 'terminal', 'run_command'):
        return {'kind': 'command', 'command': _command(arguments.get('command') or arguments.get('cmd') or arguments.get('script'))}
    if tool in ('read', 'read_file', 'readfile'):
        return {'kind': 'read', 'target': target}
    if tool in ('grep', 'search', 'glob', 'find', 'search_files'):
        return {'kind': 'search', 'target': target, 'query': _clean(arguments.get('pattern') or arguments.get('query'))}
    if tool in ('ls', 'list', 'list_directory', 'list_files'):
        return {'kind': 'list', 'target': target}
    if tool in ('edit', 'write', 'write_file', 'apply_patch', 'edit_file'):
        return {'kind': 'edit', 'target': target}
    return {'kind': 'tool', 'target': _clean(str(name), 160)}


def _turn(data):
    value = data.get('turn')
    return str(value) if type(value) is int and value >= 0 else None


def messages(records):
    result, calls = [], {}
    final_assistant = None
    for item in records:
        event = item.get('event', {})
        data, kind = event.get('data') or {}, event.get('type')
        if not isinstance(data, dict):
            continue
        sequence, turn = event.get('seq'), _turn(data)
        meta = {'turnId': turn} if turn is not None else {}
        if kind == 'turn/start':
            final_assistant = None
        elif kind == 'turn/end':
            ending = data.get('reason') or {}
            ending = ending.get('kind') if isinstance(ending, dict) else None
            if (final_assistant is not None and isinstance(data.get('reason'), dict)
                    and data['reason'].get('kind') == 'completed'
                    and type(sequence) is int and sequence >= 0):
                final_assistant['forkMessageId'] = str(sequence)
            final_assistant = None
            # A native end closes pending tool displays; idle alone never does.
            for row in calls.values():
                if row.get('turnId') == turn and row.get('status') == 'inProgress':
                    row['status'] = 'interrupted'
            failure = {'error': 'DeepSeek 本轮执行失败，请在桌面查看错误详情。',
                       'blocked': 'DeepSeek 本轮执行已被阻止，请检查权限或审批状态。',
                       'max-tokens': 'DeepSeek 本轮已达到输出上限，可发送消息继续。'}.get(ending)
            if failure:
                result.append({'id': 'turn-end:' + str(sequence), 'role': 'error', 'text': failure,
                               'endReason': ending, **meta})
        elif kind in ('user/message', 'assistant/message'):
            message = data.get('message', data)
            if not isinstance(message, dict):
                continue
            content = message.get('content', [])
            if isinstance(content, str):
                content = [{'type': 'text', 'text': content}]
            if not isinstance(content, list):
                continue
            # Harness Desktop uses event.data.source for injected user contexts.
            source = data.get('source') or {}
            context = kind == 'user/message' and isinstance(source, dict) and isinstance(source.get('kind'), str) and source['kind'] != 'user'
            for index, block in enumerate(content):
                if not isinstance(block, dict):
                    continue
                text = _text([block])
                if not text:
                    continue
                role = 'context' if context else 'reasoning' if block.get('type') in ('thinking', 'reasoning') else kind.split('/')[0]
                row = {'id': str(sequence) + ':' + str(index), 'role': role, 'text': text, **meta}
                if context:
                    row.update(title='会话上下文', contextSource=source['kind'])
                result.append(row)
                if role == 'assistant':
                    final_assistant = row
        elif kind == 'tool/call':
            call_id = data.get('callId')
            key = (turn, call_id) if isinstance(call_id, str) and call_id else None
            row = {'id': 'tool:' + str(turn) + ':' + call_id if key else str(sequence),
                   'role': 'activity', 'title': data.get('name') or data.get('toolName') or '工具',
                   'text': json.dumps(data, ensure_ascii=False, indent=2),
                   'status': 'inProgress', 'action': _action(data), **meta}
            row['callText'] = row['text']
            if key:
                row['toolCallId'] = call_id
                calls[key] = row
            result.append(row)
        elif kind == 'tool/result':
            message = data.get('message') or {}
            if not isinstance(message, dict):
                continue
            source = message.get('source') or {}
            call_id = message.get('toolCallId') or (source.get('callId') if isinstance(source, dict) else None)
            key = (turn, call_id) if isinstance(call_id, str) and call_id else None
            row = calls.get(key) if key else None
            if row is None:
                row = {'id': 'tool:' + str(turn) + ':' + call_id if key else str(sequence),
                       'role': 'activity', 'title': '工具结果', 'text': '', 'resultOnly': True, **meta}
                if key:
                    row['toolCallId'] = call_id
                result.append(row)
            row['status'] = 'failed' if message.get('isError') is True or data.get('error') else 'completed'
            output = _text(message.get('content', [])) or json.dumps(data, ensure_ascii=False, indent=2)
            row['text'] += ('\n\n' if row['text'] else '') + output
        elif kind == 'todo/write':
            result.append({'id': str(sequence), 'role': 'activity', 'kind': 'todo', 'title': '任务进度',
                           'text': json.dumps(data, ensure_ascii=False, indent=2), **meta})
    return result


def current_activity(records, running, projected=None):
    if running is not True:
        return None
    events = [row.get('event', {}) for row in records]
    latest = next((event for event in reversed(events) if _turn(event.get('data') or {}) is not None), None)
    if latest is None or latest.get('type') == 'turn/end':
        return {'kind': 'working'}
    turn = _turn(latest.get('data') or {})
    active = [event for event in events if _turn(event.get('data') or {}) == turn]
    if any(event.get('type') == 'turn/end' for event in active):
        return {'kind': 'working'}
    activity = {'turnId': turn, 'kind': 'thinking'}
    start = next((event.get('time') for event in active if event.get('type') == 'turn/start'), None)
    if type(start) in (int, float) and 0 < start < 10**14:
        activity['startedAt'] = start
    tools = [row for row in (projected if projected is not None else messages(records)) if row.get('turnId') == turn and row.get('action')]
    tool = next((row for row in reversed(tools) if row.get('status') == 'inProgress'), tools[-1] if tools else None)
    if tool:
        activity.update(tool['action'], status=tool['status'])
    elif latest.get('type') == 'assistant/message':
        activity['kind'] = 'replying'
    return activity
