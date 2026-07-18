#!/bin/bash

# --- Color Codes ---
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}===================================================${NC}"
echo -e "${CYAN}        STARTING EMPLOYEE FACE AI MAINFRAME        ${NC}"
echo -e "${CYAN}===================================================${NC}"

# --- Log Rotation ---
# backend.log/frontend.log are plain stdout redirects and grow unbounded
# otherwise. Rotate (numbered backups, oldest dropped) whenever a log
# exceeds MAX_LOG_BYTES, before that run's process starts appending to it.
MAX_LOG_BYTES=$((5 * 1024 * 1024)) # 5 MB
MAX_LOG_BACKUPS=3

rotate_log_if_large() {
    local logfile="$1"
    [ -f "$logfile" ] || return 0
    local size
    size=$(wc -c < "$logfile" 2>/dev/null || echo 0)
    if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
        for ((i = MAX_LOG_BACKUPS - 1; i >= 1; i--)); do
            [ -f "${logfile}.$i" ] && mv "${logfile}.$i" "${logfile}.$((i + 1))"
        done
        mv "$logfile" "${logfile}.1"
    fi
}

# 1. Start Docker Container (PostgreSQL)
echo -e "\n${YELLOW}[1/3] Starting Database Container...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed or not in PATH.${NC}"
    exit 1
fi

docker compose up -d
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to spin up PostgreSQL container.${NC}"
    exit 1
fi
echo -e "${GREEN}✔ PostgreSQL container is running.${NC}"

# 2. Start Python Backend API Server
echo -e "\n${YELLOW}[2/3] Starting Python API Server (Port 8000)...${NC}"
if [ ! -f "./venv/bin/python" ]; then
    echo -e "${RED}Error: Python virtual environment not found. Please run setup first.${NC}"
    exit 1
fi

rotate_log_if_large "backend.log"

# Launch Backend in the background
./venv/bin/python -u server.py > backend.log 2>&1 &
BACKEND_PID=$!

# Wait briefly and verify if backend started successfully
sleep 2
if ps -p $BACKEND_PID > /dev/null; then
    echo -e "${GREEN}✔ Backend API Server started successfully (PID: $BACKEND_PID). Logs at backend.log${NC}"
else
    echo -e "${RED}Error: Backend server failed to start. Check backend.log for details.${NC}"
    exit 1
fi

# 3. Start Angular Development Client
echo -e "\n${YELLOW}[3/3] Starting Angular Development Server (Port 4200)...${NC}"
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}node_modules not found. Installing dependencies...${NC}"
    cd frontend && npm install && cd ..
fi

rotate_log_if_large "frontend.log"

# Launch Angular Client in the background
cd frontend
npm start > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait briefly and verify if frontend started
sleep 2
if ps -p $FRONTEND_PID > /dev/null; then
    echo -e "${GREEN}✔ Angular dev server started successfully (PID: $FRONTEND_PID). Logs at frontend.log${NC}"
else
    echo -e "${RED}Error: Frontend dev server failed to start. Check frontend.log for details.${NC}"
    kill $BACKEND_PID
    exit 1
fi

echo -e "\n${GREEN}===================================================${NC}"
echo -e "${GREEN}   EMPLOYEE FACE AI DEPLOYED SUCCESSFULLY!          ${NC}"
echo -e "${GREEN}===================================================${NC}"
echo -e "👉 Biometric Kiosk:      ${CYAN}http://localhost:4200/${NC}"
echo -e "👉 Mainframe Admin Login: ${CYAN}http://localhost:4200/login${NC}"
echo -e "👉 Backend REST API URL:  ${CYAN}http://localhost:8000/api/${NC}"
echo -e "\nPress ${YELLOW}[Ctrl+C]${NC} to stop all servers and terminate."

# Keep script running and handle termination cleanup
cleanup() {
    echo -e "\n\n${YELLOW}Stopping servers and shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}✔ Servers stopped successfully.${NC}"
    exit 0
}

trap cleanup INT TERM

# Wait on background processes
wait
