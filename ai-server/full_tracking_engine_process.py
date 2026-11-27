"""Own and reap native subprocess trees, including Windows FFmpeg children."""
import os
import signal
import subprocess
import time


def process_options():
    if os.name == 'nt':
        return {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
    return {'start_new_session': True}


def _signal_group(identity, sent):
    try:
        os.killpg(identity, sent)
        return True
    except ProcessLookupError:
        return False


def terminate_tree(process):
    if os.name != 'nt':
        # process_options starts a private session whose PGID is this PID.
        # Keep the leader unreaped until group cleanup to prevent PID reuse;
        # parent exit does not prove that its FFmpeg descendants have exited.
        deadline = time.monotonic() + 2
        if _signal_group(process.pid, signal.SIGTERM):
            while _signal_group(process.pid, 0):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    _signal_group(process.pid, signal.SIGKILL)
                    break
                time.sleep(min(.05, remaining))
        process.wait(timeout=5)
        return
    # The parent must still exist when taskkill enumerates descendants. Do not
    # call process.kill() first: that reproduces the original orphan bug.
    if process.poll() is None:
        try:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired):
            pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run_managed(arguments, timeout, **kwargs):
    process = subprocess.Popen(arguments, **process_options(), **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)
    except BaseException:
        terminate_tree(process)
        raise
