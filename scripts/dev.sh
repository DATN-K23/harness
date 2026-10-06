#!/usr/bin/env bash
# ==============================================================================
# Script khởi chạy đồng thời Backend (FastAPI) và Frontend (Vite)
# Hỗ trợ realtime log streaming với tiền tố màu sắc rõ ràng & graceful shutdown
# ==============================================================================

set -m # Enable job control để quản lý process group

# Bảng mã màu ANSI
C_RESET="\033[0m"
C_BACKEND="\033[1;36m"   # Cyan (Backend)
C_FRONTEND="\033[1;32m"  # Green (Frontend)
C_INFO="\033[1;35m"      # Magenta (System)
C_WARN="\033[1;33m"      # Yellow (Warning)
C_ERR="\033[1;31m"       # Red (Error)

# Xác định thư mục gốc của project (hỗ trợ cả chạy qua symlink dev.sh và scripts/dev.sh)
SCRIPT_REAL="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_REAL")"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
else
  PROJECT_ROOT="$SCRIPT_DIR"
fi
cd "$PROJECT_ROOT"

# Tự động nạp Node 24 và uv nếu chưa có trong PATH
if [ -d "$HOME/.nvm/versions/node/v24.18.0/bin" ]; then
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
fi
if [ -d "$HOME/.local/bin" ]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

echo -e "${C_INFO}================================================================${C_RESET}"
echo -e "${C_INFO}🚀 AUDIT HARNESS: KHỞI ĐỘNG HỆ THỐNG (FULL-STACK DEV MODE)${C_RESET}"
echo -e "${C_INFO}================================================================${C_RESET}"

# Kiểm tra công cụ cần thiết
if ! command -v uv &> /dev/null; then
  echo -e "${C_ERR}[LỖI] Không tìm thấy 'uv'. Hãy đảm bảo uv đã được cài đặt tại ~/.local/bin/uv${C_RESET}"
  exit 1
fi

if ! command -v pnpm &> /dev/null; then
  echo -e "${C_ERR}[LỖI] Không tìm thấy 'pnpm'. Đang thử dùng Node version: $(node -v 2>/dev/null || echo 'none')${C_RESET}"
  exit 1
fi

echo -e "${C_INFO}[SYSTEM] Node version : $(node -v)${C_RESET}"
echo -e "${C_INFO}[SYSTEM] pnpm version : $(pnpm -v)${C_RESET}"
echo -e "${C_INFO}[SYSTEM] uv version   : $(uv --version)${C_RESET}"
echo -e "${C_INFO}[SYSTEM] Nhấn Ctrl+C để dừng toàn bộ hệ thống.${C_RESET}\n"

# Kiểm tra và giải phóng cổng 3000 và 5173 nếu có tiến trình cũ còn treo
for port in 3000 5173; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo -e "${C_WARN}[CẢNH BÁO] Cổng $port đang bị chiếm bởi PID: $pids. Đang tự động giải phóng...${C_RESET}"
    kill -9 $pids 2>/dev/null || true
    sleep 0.5
  fi
done

# Dọn dẹp tiến trình con khi nhận tín hiệu kết thúc (Ctrl+C, SIGTERM, EXIT)
cleanup() {
  trap - INT TERM EXIT
  echo -e "\n${C_INFO}[SYSTEM] Đang gửi tín hiệu dừng tới Backend và Frontend...${C_RESET}"
  pkill -P $$ 2>/dev/null || true
  kill 0 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${C_INFO}[SYSTEM] Đã dừng toàn bộ hệ thống an toàn.${C_RESET}"
}

trap cleanup INT TERM EXIT

# 1. Khởi động Backend (FastAPI Daemon API)
echo -e "${C_BACKEND}[BACKEND] Khởi động FastAPI Daemon API tại http://127.0.0.1:3000 ...${C_RESET}"
(
  cd "$PROJECT_ROOT/runtime"
  export PYTHONUNBUFFERED=1
  uv run uvicorn harness.entrypoints.daemon.main:app --host 127.0.0.1 --port 3000 --reload 2>&1 \
    | while IFS= read -r line || [ -n "$line" ]; do
        echo -e "${C_BACKEND}[BACKEND]${C_RESET} $line"
      done
) &

# Đợi 1 giây để backend khởi động trước
sleep 1

# 2. Khởi động Frontend (React 19 + Vite)
echo -e "${C_FRONTEND}[FRONTEND] Khởi động Vite Dev Server tại http://localhost:5173 ...${C_RESET}"
(
  cd "$PROJECT_ROOT/apps/desktop/ui"
  export FORCE_COLOR=1
  pnpm dev 2>&1 \
    | while IFS= read -r line || [ -n "$line" ]; do
        echo -e "${C_FRONTEND}[FRONTEND]${C_RESET} $line"
      done
) &

# Chờ đợi tất cả tiến trình nền
wait
