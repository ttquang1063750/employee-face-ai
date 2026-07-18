#!/bin/bash
# Runs the check-in scaling benchmark (benchmarks/checkin_scaling_bench.py)
# using the project's venv. Any arguments are forwarded as employee counts,
# e.g.: ./benchmarks/run_bench.sh 1 25 100 300 500

set -e

CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f "./venv/bin/python" ]; then
    echo -e "${RED}Error: Python virtual environment not found. Please run setup first.${NC}"
    exit 1
fi

echo -e "${CYAN}Running check-in scaling benchmark...${NC}"
./venv/bin/python benchmarks/checkin_scaling_bench.py "$@"
