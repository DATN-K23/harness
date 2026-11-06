#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "--version" ]; then
    printf 'solc, the solidity compiler commandline interface\nVersion: 0.8.30+commit.73712a01.Emscripten.clang\n'
    exit 0
  fi
done

while [ "$#" -gt 0 ]; do
  if [ "$1" = "--allow-paths" ]; then shift 2; else shift; fi
done

exec node /opt/solc/solc.js --standard-json 2>/dev/null | sed -n '/^{/,$p'
