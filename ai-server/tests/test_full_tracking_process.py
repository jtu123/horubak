import os
import signal
import subprocess
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from full_tracking_engine_process import run_managed
import full_tracking_engine_process as processes


def test_timeout_stops_real_grandchild_heartbeat(tmp_path):
    beat = tmp_path / 'heartbeat.txt'
    descendant = tmp_path / 'descendant.py'
    descendant.write_text('import pathlib,sys,time\np=pathlib.Path(sys.argv[1])\nwhile True:\n p.write_text(str(time.time()))\n time.sleep(.05)\n')
    parent = tmp_path / 'parent.py'
    parent.write_text('import subprocess,sys,time\nsubprocess.Popen([sys.executable,sys.argv[1],sys.argv[2]])\ntime.sleep(30)\n')
    with pytest.raises(subprocess.TimeoutExpired):
        run_managed([sys.executable, str(parent), str(descendant), str(beat)], .8,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert beat.exists(), 'The actual descendant must have started'
    last = beat.read_text()
    time.sleep(.25)
    assert beat.read_text() == last, 'FFmpeg-equivalent descendant must not keep working after parent timeout'


@pytest.mark.parametrize('parent_already_exited', [False, True])
def test_posix_cleanup_kills_descendant_when_parent_exits_first(parent_already_exited):
    state = {'parent_alive': not parent_already_exited, 'descendant_alive': True, 'now': 0., 'signals': []}
    class Worker:
        pid = 40400
        def poll(self):
            return None if state['parent_alive'] else 0
        def wait(self, timeout=None):
            assert not state['parent_alive']
            return 0
    def kill_group(pid, sent):
        assert pid == Worker.pid
        state['signals'].append(int(sent))
        if sent == signal.SIGTERM:
            state['parent_alive'] = False
        elif sent == 9:
            state['descendant_alive'] = False
        elif not state['descendant_alive']:
            raise ProcessLookupError()
    def sleep(seconds):
        state['now'] += seconds
    clock = SimpleNamespace(monotonic=lambda: state['now'], sleep=sleep)
    with patch.object(processes.os, 'name', 'posix'), patch.object(processes.os, 'killpg', kill_group, create=True), \
            patch.object(processes.signal, 'SIGKILL', 9, create=True), patch.object(processes, 'time', clock, create=True):
        processes.terminate_tree(Worker())
    assert state['descendant_alive'] is False
    assert int(signal.SIGTERM) in state['signals'] and 9 in state['signals']
    assert state['now'] >= 2., 'A child receives the full graceful termination window even if its parent exits immediately'


def test_posix_cleanup_surfaces_permission_errors():
    class Worker:
        pid = 40400
        def wait(self, timeout=None):
            return 0
    with patch.object(processes.os, 'name', 'posix'), \
            patch.object(processes.os, 'killpg', side_effect=PermissionError('not owned'), create=True):
        with pytest.raises(PermissionError):
            processes.terminate_tree(Worker())


@pytest.mark.parametrize('disappears_at', ['term', 'probe', 'kill'])
def test_posix_group_exit_races_are_harmless_and_parent_is_reaped(disappears_at):
    state = {'now': 0., 'reaped': False}
    class Worker:
        pid = 40400
        def wait(self, timeout=None):
            state['reaped'] = True
            return 0
    def kill_group(pid, sent):
        assert pid == Worker.pid
        stage = 'term' if sent == signal.SIGTERM else 'kill' if sent == 9 else 'probe'
        if stage == disappears_at:
            raise ProcessLookupError()
    def sleep(seconds):
        state['now'] += seconds
    clock = SimpleNamespace(monotonic=lambda: state['now'], sleep=sleep)
    with patch.object(processes.os, 'name', 'posix'), patch.object(processes.os, 'killpg', kill_group, create=True), \
            patch.object(processes.signal, 'SIGKILL', 9, create=True), patch.object(processes, 'time', clock):
        processes.terminate_tree(Worker())
    assert state['reaped']


@pytest.mark.skipif(os.name == 'nt', reason='Requires native POSIX process groups and signals')
def test_posix_timeout_stops_sigterm_ignoring_child_and_grandchild(tmp_path):
    child_beat, grandchild_beat = tmp_path / 'child.txt', tmp_path / 'grandchild.txt'
    group_file = tmp_path / 'group.txt'
    descendant = tmp_path / 'ignore-term.py'
    descendant.write_text(
        'import pathlib,signal,subprocess,sys,time\n'
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)\n'
        'if len(sys.argv)>2: subprocess.Popen([sys.executable,__file__,sys.argv[2]])\n'
        'p=pathlib.Path(sys.argv[1])\n'
        'while True:\n p.write_text(str(time.time()))\n time.sleep(.05)\n'
    )
    parent = tmp_path / 'parent-default-term.py'
    parent.write_text(
        'import os,pathlib,subprocess,sys,time\n'
        'pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))\n'
        'subprocess.Popen([sys.executable,sys.argv[2],sys.argv[3],sys.argv[4]])\n'
        'time.sleep(30)\n'
    )
    finished = False
    try:
        with pytest.raises(subprocess.TimeoutExpired):
            run_managed([sys.executable, str(parent), str(group_file), str(descendant), str(child_beat), str(grandchild_beat)],
                        1., stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert child_beat.exists() and grandchild_beat.exists()
        before = child_beat.read_text(), grandchild_beat.read_text()
        time.sleep(.25)
        assert (child_beat.read_text(), grandchild_beat.read_text()) == before
        finished = True
    finally:
        if not finished and group_file.exists():
            try:
                os.killpg(int(group_file.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass
