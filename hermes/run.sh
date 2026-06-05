#!/bin/bash
if [ -z "$1" ]; then
    echo "Usage: ./run.sh <config_file>"
    exit 1
fi

# Secrets are read from the environment, never from the config file.
export ALPACA_API_KEY=${ALPACA_API_KEY}
export ALPACA_API_SECRET=${ALPACA_API_SECRET}

./build/hermes "$1"
