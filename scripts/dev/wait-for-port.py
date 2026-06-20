#!/usr/bin/env python3
import socket
import sys
import time


host = sys.argv[1]
port = int(sys.argv[2])
deadline = time.time() + float(sys.argv[3] if len(sys.argv) > 3 else 20)

while time.time() < deadline:
    try:
        with socket.create_connection((host, port), timeout=1):
            sys.exit(0)
    except OSError:
        time.sleep(0.2)

print(f"Timed out waiting for {host}:{port}", file=sys.stderr)
sys.exit(1)
