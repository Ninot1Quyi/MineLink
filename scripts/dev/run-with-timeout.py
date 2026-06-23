#!/usr/bin/env python3
import argparse
import os
import signal
import subprocess
import sys
from typing import List


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a command with a wall-clock timeout.")
    parser.add_argument("--timeout", type=float, required=True, help="Timeout in seconds. Use 0 to disable.")
    parser.add_argument("--grace", type=float, default=10.0, help="Seconds to wait after SIGTERM before SIGKILL.")
    parser.add_argument("--label", default="command", help="Human-readable label for timeout messages.")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("command is required after --")
    if args.timeout < 0:
        parser.error("--timeout must be non-negative")
    if args.grace < 0:
        parser.error("--grace must be non-negative")
    return args


def terminate_process_group(process: subprocess.Popen[bytes], grace: float) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        process.terminate()

    try:
        process.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    except PermissionError:
        process.kill()
    process.wait()


def run(command: List[str], timeout: float, grace: float, label: str) -> int:
    process = subprocess.Popen(command, start_new_session=True)
    try:
        return process.wait(timeout=None if timeout == 0 else timeout)
    except subprocess.TimeoutExpired:
        print(
            f"{label} timed out after {timeout:g}s; terminating process group.",
            file=sys.stderr,
            flush=True,
        )
        terminate_process_group(process, grace)
        return 124


def main() -> None:
    args = parse_args()
    raise SystemExit(run(args.command, args.timeout, args.grace, args.label))


if __name__ == "__main__":
    main()
