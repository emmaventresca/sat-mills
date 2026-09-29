#!/usr/bin/env python3
"""Generate a SHA-256 hash for assets/config.js.

    python3 tools/hash_password.py "my new teacher password"

Paste the result into STUDENT_PASSWORD_SHA256 or TEACHER_PASSWORD_SHA256,
then commit and push.
"""
import hashlib, sys
if len(sys.argv) != 2:
    sys.exit(__doc__)
print(hashlib.sha256(sys.argv[1].encode()).hexdigest())
