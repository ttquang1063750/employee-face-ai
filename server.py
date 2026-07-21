import os

# Force TensorFlow to run strictly on CPU to avoid device hangs on macOS Apple Silicon
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import base64
import csv
import io
import json
import re
import shutil
import tempfile
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import multipart
from deepface import DeepFace

import db

# Min 8 chars, at least one lowercase, one uppercase, one digit, one special character
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$")

# DeepFace.find()/analyze() read and rewrite a shared embeddings cache (.pkl)
# under uploads/database/ — with ThreadingHTTPServer handling requests concurrently,
# two overlapping DeepFace calls could race on that same cache file. Serialize
# just the DeepFace calls (not the rest of each request) with this lock.
DEEPFACE_LOCK = threading.Lock()

# Brute-force protection for /api/login: after MAX_LOGIN_ATTEMPTS failures
# for the same (client IP, username) within LOGIN_WINDOW_SECONDS, that pair
# is locked out for LOGIN_LOCKOUT_SECONDS. Keyed on the pair (not IP alone)
# so one attacker can't lock out every other account sharing their network,
# and not on username alone so it can't be used to lock a real user out from
# their own IP by failing from elsewhere.
LOGIN_ATTEMPTS_LOCK = threading.Lock()
login_attempts = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_LOCKOUT_SECONDS = 5 * 60


def check_login_rate_limit(key):
    """Returns seconds remaining if `key` is currently locked out, else None."""
    with LOGIN_ATTEMPTS_LOCK:
        entry = login_attempts.get(key)
        if not entry:
            return None
        now = time.time()
        locked_until = entry.get("locked_until")
        if locked_until:
            if now < locked_until:
                return round(locked_until - now)
            del login_attempts[key]
            return None
        if now - entry["window_start"] > LOGIN_WINDOW_SECONDS:
            del login_attempts[key]
        return None


def register_failed_login(key):
    with LOGIN_ATTEMPTS_LOCK:
        now = time.time()
        entry = login_attempts.get(key)
        if not entry or now - entry["window_start"] > LOGIN_WINDOW_SECONDS:
            entry = {"count": 0, "window_start": now, "locked_until": None}
        entry["count"] += 1
        if entry["count"] >= MAX_LOGIN_ATTEMPTS:
            entry["locked_until"] = now + LOGIN_LOCKOUT_SECONDS
        login_attempts[key] = entry


def reset_login_attempts(key):
    with LOGIN_ATTEMPTS_LOCK:
        login_attempts.pop(key, None)


# DeepFace keys its embeddings cache (uploads/database/*.pkl) by detector_backend, so
# using a different backend for registration's face checks than for check-in
# silently doubles cache/compute cost — every photo gets embedded once per
# backend ever used against it. Registration's has_detectable_face/
# find_duplicate_face default to this, matching handle_attendance's default,
# so the common case shares one cache; an operator can still pick a
# different detector at check-in time (kiosk.ts's detector selector) without
# affecting this shared default.
DEFAULT_DETECTOR_BACKEND = "retinaface"

# Every uploaded/captured file lives under one uploads/ root (see AGENTS.md's
# Unified Uploads Root rule), each kind in its own subfolder rather than
# scattered as separate top-level directories.
UPLOADS_ROOT = "uploads"
DATABASE_DIR = os.path.join(UPLOADS_ROOT, "database")  # employee reference photos + DeepFace's embedding cache

# Check-in/check-out audit photos (uploads/logs/*.jpg) are served to admins
# only (see serve_audit_image) — they're forensic evidence, not a public
# asset like a reference photo — and accumulate one file per scan forever
# otherwise. Prune anything older than LOG_RETENTION_DAYS once a day; this
# only removes the on-disk JPEG, never the attendance_logs DB row or its
# timestamp/mood metadata, so the audit trail's history stays intact.
LOGS_DIR = os.path.join(UPLOADS_ROOT, "logs")
LOG_RETENTION_DAYS = 90
LOG_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60

os.makedirs(DATABASE_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


def cleanup_old_audit_logs():
    if not os.path.isdir(LOGS_DIR):
        return
    cutoff = time.time() - LOG_RETENTION_DAYS * 86400
    removed = 0
    for name in os.listdir(LOGS_DIR):
        path = os.path.join(LOGS_DIR, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError as e:
            print(f"Could not remove old audit log {path}: {e}", flush=True)
    if removed:
        print(f"Log retention: removed {removed} audit photo(s) older than {LOG_RETENTION_DAYS} days.", flush=True)


def start_log_retention_thread():
    def loop():
        while True:
            cleanup_old_audit_logs()
            time.sleep(LOG_CLEANUP_INTERVAL_SECONDS)

    threading.Thread(target=loop, daemon=True).start()


MOOD_TRANSLATION = {
    "happy": "Vui vẻ 😊",
    "sad": "Buồn bã 😢",
    "angry": "Tức giận 😠",
    "surprise": "Ngạc nhiên 😲",
    "fear": "Lo sợ 😨",
    "disgust": "Khó chịu 😣",
    "neutral": "Bình thường 😐",
}


# Caps how large any single uploaded/captured reference or check-in photo can
# be, so a deliberately huge image can't be used to blow up disk usage or
# stall a DeepFace call (detection/embedding time scales with image size).
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB

# HR documents (payroll slips, contracts, videos, etc.) aren't run through
# DeepFace and can legitimately be large (a scanned PDF, a short video), so
# they get their own, much larger cap rather than sharing MAX_IMAGE_BYTES.
# Documents are the one upload path streamed via real multipart/form-data
# (see handle_create_document) rather than base64-in-JSON, specifically so
# a cap this size doesn't mean holding the whole payload in RAM at once.
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB

DOCUMENTS_DIR = os.path.join(UPLOADS_ROOT, "documents")
os.makedirs(DOCUMENTS_DIR, exist_ok=True)

# Shape drawings inserted into message/template rich content — filenames are
# random (not the sequential message/template id) since these are served
# back over a public, unauthenticated static route just like avatar photos.
MESSAGE_IMAGES_DIR = os.path.join(UPLOADS_ROOT, "messages")
os.makedirs(MESSAGE_IMAGES_DIR, exist_ok=True)
DOCUMENT_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}

# Allowed URL schemes for a "link"-source document (see handle_create_document)
# — deliberately excludes javascript:/data:/file: etc., since external_url is
# later handed straight to the browser as a link target (window.open/href).
ALLOWED_EXTERNAL_URL_SCHEMES = ("http://", "https://")


def base64_within_size_limit(base64_str, max_bytes):
    """Cheap check against the base64 string length (no decoding) so an
    oversized payload is rejected before we spend time decoding/writing it."""
    if not base64_str:
        return False
    encoded = base64_str.split(",", 1)[-1]
    estimated_bytes = (len(encoded) * 3) // 4
    return estimated_bytes <= max_bytes


def image_within_size_limit(base64_str):
    return base64_within_size_limit(base64_str, MAX_IMAGE_BYTES)


# Message/template content is now rich HTML from the frontend's Tiptap editor
# — its "empty" state is still non-blank markup (an empty <p></p>), so a
# plain falsy/strip() check on the raw string (as used for every other
# plain-text field) never catches it. Mirrors isRichContentEmpty in
# frontend/src/app/core/utils/rich-content.util.ts.
def is_rich_content_empty(html):
    if not html:
        return True
    if re.search(r"<img\b", html, re.IGNORECASE):
        return False
    return re.sub(r"<[^>]*>", "", html).strip() == ""


def save_base64_file(base64_str, output_path, max_bytes):
    try:
        header, encoded = base64_str.split(",", 1)
        data = base64.b64decode(encoded)
        if len(data) > max_bytes:
            print(f"Rejected file write: {len(data)} bytes exceeds the {max_bytes}-byte limit", flush=True)
            return False
        with open(output_path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        print(f"Error saving base64 file: {e}", flush=True)
        return False


def save_base64_image(base64_str, output_path):
    return save_base64_file(base64_str, output_path, MAX_IMAGE_BYTES)


class EmployeeFaceAIRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS headers for development/testing
        self.send_header("Access-Control-Allow-Origin", "http://localhost:4200")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Credentials", "true")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def get_authenticated_user(self):
        auth_header = self.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        token = auth_header.split(" ")[1]
        session = db.verify_session(token)
        return session

    def do_GET(self):
        # Router
        if self.path == "/api/logs/export":
            self.handle_export_csv()
        elif self.path == "/api/logs":
            self.handle_get_logs()
        elif self.path == "/api/employees":
            self.handle_get_employees()
        elif self.path == "/api/employees/directory":
            self.handle_get_employee_directory()
        elif self.path == "/api/leave-requests":
            self.handle_get_all_leave_requests()
        elif self.path == "/api/documents":
            self.handle_get_all_documents()
        elif self.path == "/api/messages/received":
            self.handle_get_received_messages()
        elif self.path == "/api/messages/sent":
            self.handle_get_sent_messages()
        elif self.path == "/api/message-templates":
            self.handle_get_message_templates()
        elif self.path.startswith("/api/messages/"):
            self.handle_get_message_detail()
        elif self.path.startswith("/api/documents/") and self.path.endswith("/download"):
            self.handle_download_document()
        elif self.path.startswith("/api/employees/check-username"):
            self.handle_check_username()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/leave-requests"):
            self.handle_get_leave_requests()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/documents"):
            self.handle_get_employee_documents()
        elif self.path.startswith("/api/employees/"):
            self.handle_get_employee_detail()
        elif self.path.startswith("/uploads/database/"):
            self.serve_database_image()
        elif self.path.startswith("/uploads/logs/"):
            self.serve_audit_image()
        elif self.path.startswith("/uploads/messages/"):
            self.serve_message_image()
        # Serve the single page index.html for static hosting fallback
        elif self.path == "/" or self.path == "/index.html":
            self.serve_static_index()
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        if self.path == "/api/login":
            self.handle_login()
        elif self.path == "/api/refresh":
            self.handle_refresh_token()
        elif self.path == "/api/logout":
            self.handle_logout()
        elif self.path == "/api/employees":
            self.handle_create_employee()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/positions"):
            self.handle_promote_position()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/income"):
            self.handle_adjust_income()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/leave-requests"):
            self.handle_create_leave_request()
        elif self.path == "/api/documents":
            self.handle_create_document()
        elif self.path == "/api/messages":
            self.handle_create_message()
        elif self.path == "/api/messages/images":
            self.handle_upload_message_image()
        elif self.path == "/api/message-templates":
            self.handle_create_message_template()
        elif self.path == "/api/attendance":
            self.handle_attendance()
        else:
            self.send_error(404, "Endpoint Not Found")

    def do_PUT(self):
        if self.path.startswith("/api/leave-requests/"):
            self.handle_update_leave_request_status()
        elif self.path.startswith("/api/messages/") and self.path.endswith("/read"):
            self.handle_mark_message_read()
        elif self.path.startswith("/api/message-templates/"):
            self.handle_update_message_template()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/skills"):
            self.handle_update_skills()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/projects"):
            self.handle_update_projects()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/password"):
            self.handle_change_password()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/avatar"):
            self.handle_change_avatar()
        elif self.path.startswith("/api/employees/"):
            self.handle_update_employee()
        else:
            self.send_error(404, "Endpoint Not Found")

    def do_DELETE(self):
        if self.path.startswith("/api/positions/"):
            self.handle_delete_position()
        elif self.path.startswith("/api/income/"):
            self.handle_delete_income()
        elif self.path.startswith("/api/employees/"):
            self.handle_delete_employee()
        elif self.path.startswith("/api/logs/"):
            self.handle_delete_log()
        elif self.path.startswith("/api/documents/"):
            self.handle_delete_document()
        elif self.path.startswith("/api/message-templates/"):
            self.handle_delete_message_template()
        elif self.path.startswith("/api/messages/"):
            self.handle_delete_message()
        else:
            self.send_error(404, "Endpoint Not Found")

    # API Handlers
    def serve_static_index(self):
        try:
            with open("index.html", "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_error(404, "File Not Found: index.html")

    def _serve_local_file(self, root_dir, relative_path, content_type_map=None, download_name=None):
        root = os.path.realpath(root_dir)
        requested_path = os.path.realpath(os.path.join(root, relative_path))

        # Guard against path traversal outside the given root directory
        if os.path.commonpath([root, requested_path]) != root:
            self.send_error(403, "Forbidden")
            return

        ext = os.path.splitext(requested_path)[1].lower()
        content_type_map = content_type_map or {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
        content_type = content_type_map.get(ext)
        if not content_type:
            self.send_error(403, "Forbidden")
            return

        try:
            file_size = os.path.getsize(requested_path)
            with open(requested_path, "rb") as f:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(file_size))
                if download_name:
                    self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
                self.end_headers()
                # Chunked copy (not f.read() into memory) — documents can now
                # be gigabytes (see MAX_DOCUMENT_BYTES), so the whole file
                # must never be buffered in RAM at once for a download either.
                shutil.copyfileobj(f, self.wfile, length=1024 * 1024)
        except FileNotFoundError:
            self.send_error(404, "File Not Found")

    def serve_database_image(self):
        self._serve_local_file(DATABASE_DIR, self.path[len("/uploads/database/") :])

    def serve_message_image(self):
        self._serve_local_file(MESSAGE_IMAGES_DIR, self.path[len("/uploads/messages/") :])

    def serve_audit_image(self):
        # Audit photos are forensic evidence of a specific person's face at a
        # specific time — unlike reference avatars, viewing is restricted.
        # Admins may view any employee's; a staff member may only view their
        # own (the employee_id embedded in the filename, e.g.
        # "20260719_044221_CHECK_IN_11.jpg", must match their own session).
        user = self.get_authenticated_user()
        if not user:
            self.send_error(401, "Unauthorized")
            return

        relative_path = self.path[len("/uploads/logs/") :]
        if user["role"] != "admin":
            stem = os.path.splitext(os.path.basename(relative_path))[0]
            try:
                owner_id = int(stem.rsplit("_", 1)[-1])
            except ValueError:
                owner_id = None
            if owner_id != user["employee_id"]:
                self.send_error(401, "Unauthorized")
                return

        self._serve_local_file(LOGS_DIR, relative_path)

    def handle_login(self):
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            username = data.get("username")
            password = data.get("password")
            rate_limit_key = (self.client_address[0], (username or "").strip().lower())

            retry_after = check_login_rate_limit(rate_limit_key)
            if retry_after is not None:
                self.send_json_response(
                    429,
                    {
                        "success": False,
                        "error": f"Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau {retry_after} giây.",
                    },
                )
                return

            employee_id = db.verify_login_credentials(username, password)
            if employee_id:
                reset_login_attempts(rate_limit_key)
                tokens = db.create_session(employee_id)
                user = db.get_employee_basic(employee_id)
                self.send_json_response(200, {"success": True, "tokens": tokens, "user": user})
            else:
                register_failed_login(rate_limit_key)
                self.send_json_response(401, {"success": False, "error": "Username hoặc mật khẩu không đúng."})
        except Exception as e:
            self.send_json_response(400, {"success": False, "error": f"Lỗi yêu cầu: {str(e)}"})

    def handle_refresh_token(self):
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            refresh_token = data.get("refresh_token")
            if not refresh_token:
                self.send_json_response(400, {"success": False, "error": "Thiếu Refresh Token."})
                return

            tokens = db.refresh_session(refresh_token)
            if tokens:
                self.send_json_response(200, {"success": True, "tokens": tokens})
            else:
                self.send_json_response(
                    401,
                    {"success": False, "error": "Refresh Token đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại."},
                )
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_logout(self):
        auth_header = self.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            db.revoke_session(token)
        self.send_json_response(200, {"success": True})

    def handle_get_employees(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Token expired or unauthorized access"})
            return

        try:
            employees = db.get_all_employees()
            self.send_json_response(200, {"success": True, "data": employees})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_employee_directory(self):
        # Any authenticated employee (not just Admin) — used by the message
        # compose page's recipient picker, which lets anyone message anyone.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            employees = db.get_employee_directory()
            self.send_json_response(200, {"success": True, "data": employees})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_employee_detail(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            employee_id = int(self.path.split("/")[-1])

            # Admins can view any employee; staff may only view their own record
            if user["role"] != "admin" and user["employee_id"] != employee_id:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            employee = db.get_detailed_employee(employee_id)
            if employee:
                self.send_json_response(200, {"success": True, "data": employee})
            else:
                self.send_json_response(404, {"success": False, "error": "Nhân viên không tồn tại."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_check_username(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            query = parse_qs(urlparse(self.path).query)
            username = (query.get("username", [""])[0] or "").strip()
            exclude_id = query.get("exclude_id", [None])[0]
            exclude_id = int(exclude_id) if exclude_id else None

            if not username:
                self.send_json_response(400, {"success": False, "error": "Thiếu username cần kiểm tra."})
                return

            exists = db.username_exists(username, exclude_id)
            self.send_json_response(200, {"success": True, "exists": exists})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def has_detectable_face(self, img_base64):
        """Returns True if img_base64 contains at least one detectable human face.
        A registration/edit photo of an object, a blank wall, etc. would never be
        matchable later at kiosk check-in, so this must run before accepting any
        reference photo. Any error other than "no face found" (e.g. a corrupt
        image) is also treated as invalid — a photo we can't even inspect can't
        be trusted as a valid reference either."""
        temp_img_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_img_path = temp_file.name
            if not save_base64_image(img_base64, temp_img_path):
                return False

            with DEEPFACE_LOCK:
                faces = DeepFace.extract_faces(
                    img_path=temp_img_path, detector_backend=DEFAULT_DETECTOR_BACKEND, enforce_detection=True
                )
            return len(faces) > 0
        except Exception as e:
            print(f"Face detection failed: {e}", flush=True)
            return False
        finally:
            if temp_img_path and os.path.exists(temp_img_path):
                os.remove(temp_img_path)

    def find_duplicate_face(self, img_base64, exclude_id=None):
        """Returns (name, employee_id) if img_base64 already matches an existing
        employee's reference photo in uploads/database/ (other than exclude_id,
        used when an employee re-uploads/recaptures their own photo), else
        None. Never raises — any DeepFace failure (no face detected, empty
        uploads/database/, etc.) is treated as "no duplicate found" so it
        never blocks registration/edits on unrelated errors."""
        if not db.get_all_employees():
            return None

        temp_img_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_img_path = temp_file.name
            if not save_base64_image(img_base64, temp_img_path):
                return None

            with DEEPFACE_LOCK:
                dfs = DeepFace.find(
                    img_path=temp_img_path,
                    db_path=DATABASE_DIR,
                    detector_backend=DEFAULT_DETECTOR_BACKEND,
                    enforce_detection=False,
                    silent=True,
                )

            if not dfs or len(dfs) == 0 or len(dfs[0]) == 0:
                return None

            for _, match_row in dfs[0].iterrows():
                try:
                    matched_id = int(os.path.splitext(os.path.basename(match_row["identity"]))[0])
                except ValueError:
                    continue
                if exclude_id is not None and matched_id == exclude_id:
                    continue

                conn = db.get_connection()
                cur = conn.cursor()
                cur.execute("SELECT name FROM employees WHERE id = %s;", (matched_id,))
                row = cur.fetchone()
                cur.close()
                conn.close()

                return (row[0] if row else f"ID #{matched_id}", matched_id)

            return None
        except Exception as e:
            print(f"Duplicate face check skipped due to error: {e}", flush=True)
            return None
        finally:
            if temp_img_path and os.path.exists(temp_img_path):
                os.remove(temp_img_path)

    def handle_create_employee(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            name = data.get("name")
            date_of_birth = data.get("date_of_birth") or None
            role = data.get("role", "staff")
            username = (data.get("username") or "").strip()
            password = data.get("password")
            img_base64 = data.get("img")

            # Initial details
            position = data.get("position", "Staff Member")
            skills = data.get("skills", [])  # list of {skill_name, description}
            projects = data.get("projects", [])  # list of {project_name, role, description}
            income = float(data.get("income", 1000.00))

            if not name or not img_base64:
                self.send_json_response(400, {"success": False, "error": "Vui lòng nhập tên và chụp ảnh mẫu."})
                return

            if not image_within_size_limit(img_base64):
                self.send_json_response(
                    400, {"success": False, "error": "Ảnh vượt quá dung lượng cho phép (tối đa 8MB)."}
                )
                return

            if not self.has_detectable_face(img_base64):
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": "Không phát hiện khuôn mặt trong ảnh. Vui lòng chụp lại ảnh rõ mặt để hệ thống có thể nhận diện.",
                    },
                )
                return

            if not username:
                self.send_json_response(400, {"success": False, "error": "Vui lòng nhập username."})
                return

            if db.username_exists(username):
                self.send_json_response(400, {"success": False, "error": "Username đã tồn tại."})
                return

            if not password or not PASSWORD_PATTERN.match(password):
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": "Mật khẩu phải tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt.",
                    },
                )
                return

            duplicate = self.find_duplicate_face(img_base64)
            if duplicate:
                dup_name, dup_id = duplicate
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": f'Khuôn mặt này đã được đăng ký cho nhân viên "{dup_name}" (ID #{dup_id}). Vui lòng chụp ảnh khác hoặc kiểm tra lại danh sách nhân sự.',
                    },
                )
                return

            # Register base profile
            temp_path = os.path.join(DATABASE_DIR, "temp.jpg")
            employee_id = db.register_employee(name, date_of_birth, temp_path, role, password, username)

            # Final filepath
            final_filepath = os.path.join(DATABASE_DIR, f"{employee_id}.jpg")
            if save_base64_image(img_base64, final_filepath):
                # Update image path
                conn = db.get_connection()
                cur = conn.cursor()
                cur.execute("UPDATE employees SET image_path = %s WHERE id = %s;", (final_filepath, employee_id))
                conn.commit()
                cur.close()
                conn.close()

                # Add initial career components
                db.add_employee_position(employee_id, position, datetime.now().date().isoformat())
                db.add_employee_income(employee_id, income, datetime.now().date().isoformat(), "Onboarding Salary")

                for sk in skills:
                    db.add_employee_skills(employee_id, sk.get("skill_name"), sk.get("description"))
                for prj in projects:
                    db.add_employee_project(
                        employee_id,
                        prj.get("project_name"),
                        prj.get("role"),
                        prj.get("description"),
                        datetime.now().date().isoformat(),
                    )

                self.send_json_response(
                    200, {"success": True, "id": employee_id, "message": "Đăng ký nhân viên mới thành công."}
                )
            else:
                self.send_json_response(500, {"success": False, "error": "Không thể lưu hình ảnh mẫu."})

        except Exception as e:
            self.send_json_response(500, {"success": False, "error": f"Lỗi đăng ký: {str(e)}"})

    def handle_update_employee(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            employee_id = int(self.path.split("/")[-1])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            name = data.get("name")
            date_of_birth = data.get("date_of_birth") or None
            role = data.get("role", "staff")
            username = (data.get("username") or "").strip()
            password = data.get("password")
            img_base64 = data.get("img")

            new_position = data.get("position")
            new_skills = data.get("skills", [])  # list of {skill_name, description}
            new_projects = data.get("projects", [])  # list of {project_name, role, description}
            new_income = data.get("income")

            if not username:
                self.send_json_response(400, {"success": False, "error": "Vui lòng nhập username."})
                return

            if db.username_exists(username, exclude_id=employee_id):
                self.send_json_response(400, {"success": False, "error": "Username đã tồn tại."})
                return

            if password and not PASSWORD_PATTERN.match(password):
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": "Mật khẩu phải tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt.",
                    },
                )
                return

            if img_base64:
                if not image_within_size_limit(img_base64):
                    self.send_json_response(
                        400, {"success": False, "error": "Ảnh vượt quá dung lượng cho phép (tối đa 8MB)."}
                    )
                    return

                if not self.has_detectable_face(img_base64):
                    self.send_json_response(
                        400,
                        {
                            "success": False,
                            "error": "Không phát hiện khuôn mặt trong ảnh. Vui lòng chụp lại ảnh rõ mặt để hệ thống có thể nhận diện.",
                        },
                    )
                    return

                duplicate = self.find_duplicate_face(img_base64, exclude_id=employee_id)
                if duplicate:
                    dup_name, dup_id = duplicate
                    self.send_json_response(
                        400,
                        {
                            "success": False,
                            "error": f'Khuôn mặt này đã được đăng ký cho nhân viên "{dup_name}" (ID #{dup_id}). Vui lòng chụp ảnh khác hoặc kiểm tra lại danh sách nhân sự.',
                        },
                    )
                    return

            # 1. Update Base Details
            db.update_employee_profile(employee_id, name, date_of_birth, role, username, password)
            current_detail = db.get_detailed_employee(employee_id)
            today_str = datetime.now().date().isoformat()

            # 1b. Update reference avatar photo, if a new one was captured/uploaded
            if img_base64:
                final_filepath = os.path.join(DATABASE_DIR, f"{employee_id}.jpg")
                if save_base64_image(img_base64, final_filepath):
                    conn = db.get_connection()
                    cur = conn.cursor()
                    cur.execute("UPDATE employees SET image_path = %s WHERE id = %s;", (final_filepath, employee_id))
                    conn.commit()
                    cur.close()
                    conn.close()

            # 2. Update Position Lifecycle
            if new_position and new_position != current_detail.get("current_position"):
                # Terminate active position
                conn = db.get_connection()
                cur = conn.cursor()
                cur.execute(
                    "UPDATE employee_positions SET end_date = %s WHERE employee_id = %s AND end_date IS NULL;",
                    (today_str, employee_id),
                )
                conn.commit()
                cur.close()
                conn.close()
                # Insert new position
                db.add_employee_position(employee_id, new_position, today_str)

            # 3. Update Income Lifecycle
            if new_income is not None:
                new_income = float(new_income)
                current_income = (
                    current_detail["income_history"][0]["amount"] if current_detail["income_history"] else 0.00
                )
                if new_income != current_income:
                    db.add_employee_income(employee_id, new_income, today_str, "Salary Adjustment / HR Update")

            # 4. Refresh Skills Registry
            conn = db.get_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM employee_skills WHERE employee_id = %s;", (employee_id,))
            conn.commit()
            cur.close()
            conn.close()
            for sk in new_skills:
                db.add_employee_skills(employee_id, sk.get("skill_name"), sk.get("description"))

            # 5. Refresh Projects Assignments (re-insert or smart update)
            conn = db.get_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM employee_projects WHERE employee_id = %s;", (employee_id,))
            conn.commit()
            cur.close()
            conn.close()
            for prj in new_projects:
                db.add_employee_project(
                    employee_id,
                    prj.get("project_name"),
                    prj.get("role"),
                    prj.get("description"),
                    prj.get("start_date", today_str),
                    prj.get("end_date"),
                )

            self.send_json_response(200, {"success": True, "message": "Cập nhật hồ sơ nhân sự thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_change_password(self):
        # Self-service only: any authenticated user (admin or staff) may change
        # their own password, but never someone else's.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            employee_id = int(self.path.split("/")[-2])
            if user["employee_id"] != employee_id:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            current_password = data.get("current_password")
            new_password = data.get("new_password")

            if not db.verify_password(employee_id, current_password):
                self.send_json_response(401, {"success": False, "error": "Mật khẩu hiện tại không đúng."})
                return

            if not new_password or not PASSWORD_PATTERN.match(new_password):
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": "Mật khẩu mới phải tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt.",
                    },
                )
                return

            db.update_employee_password(employee_id, new_password)
            self.send_json_response(200, {"success": True, "message": "Đổi mật khẩu thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_change_avatar(self):
        # Self-service only: any authenticated user may replace their own reference photo.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            employee_id = int(self.path.split("/")[-2])
            if user["employee_id"] != employee_id:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            img_base64 = data.get("img")
            if not img_base64:
                self.send_json_response(400, {"success": False, "error": "Vui lòng chụp hoặc tải lên ảnh mới."})
                return

            if not image_within_size_limit(img_base64):
                self.send_json_response(
                    400, {"success": False, "error": "Ảnh vượt quá dung lượng cho phép (tối đa 8MB)."}
                )
                return

            final_filepath = os.path.join(DATABASE_DIR, f"{employee_id}.jpg")
            if save_base64_image(img_base64, final_filepath):
                db.update_employee_avatar(employee_id, final_filepath)
                self.send_json_response(200, {"success": True, "message": "Cập nhật ảnh đại diện thành công."})
            else:
                self.send_json_response(500, {"success": False, "error": "Không thể lưu ảnh đại diện."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_employee(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            employee_id = int(self.path.split("/")[-1])
            image_path = db.delete_employee_profile(employee_id)

            # Delete physical reference file
            if image_path and os.path.exists(image_path) and "temp.jpg" not in image_path:
                os.remove(image_path)

            self.send_json_response(200, {"success": True, "message": "Xóa hồ sơ nhân sự thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_log(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            log_id = int(self.path.split("/")[-1])
            db.delete_attendance_log(log_id)
            self.send_json_response(200, {"success": True, "message": "Xóa lượt chấm công thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_attendance(self):
        temp_img_path = None
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            img_base64 = data.get("img")
            action = data.get("action")  # CHECK_IN or CHECK_OUT
            detector_backend = data.get("detector_backend", DEFAULT_DETECTOR_BACKEND)

            if not img_base64 or not action:
                self.send_json_response(
                    400, {"success": False, "error": "Thiếu dữ liệu chụp ảnh hoặc trạng thái chấm công."}
                )
                return

            if not image_within_size_limit(img_base64):
                self.send_json_response(
                    400, {"success": False, "error": "Ảnh vượt quá dung lượng cho phép (tối đa 8MB)."}
                )
                return

            employees = db.get_all_employees()
            if not employees:
                self.send_json_response(
                    400, {"success": False, "error": "Không có dữ liệu nhân viên đối sánh. Vui lòng liên hệ HR."}
                )
                return

            # Save captured image to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_img_path = temp_file.name

            save_base64_image(img_base64, temp_img_path)

            print(f"Finding match using detector: {detector_backend}...", flush=True)
            with DEEPFACE_LOCK:
                dfs = DeepFace.find(
                    img_path=temp_img_path,
                    db_path=DATABASE_DIR,
                    detector_backend=detector_backend,
                    enforce_detection=True,
                )

            if not dfs or len(dfs) == 0 or len(dfs[0]) == 0:
                self.send_json_response(
                    400, {"success": False, "error": "Không tìm thấy khuôn mặt trùng khớp trong kho dữ liệu nhân sự."}
                )
                return

            # Retrieve match filename
            matched_img_path = dfs[0].iloc[0]["identity"]
            filename = os.path.basename(matched_img_path)
            employee_id = int(os.path.splitext(filename)[0])  # filename is {employee_id}.jpg

            conn = db.get_connection()
            cur = conn.cursor()
            cur.execute("SELECT name FROM employees WHERE id = %s;", (employee_id,))
            row = cur.fetchone()
            cur.close()
            conn.close()

            if not row:
                self.send_json_response(
                    404, {"success": False, "error": "Nhân viên không tồn tại trong cơ sở dữ liệu."}
                )
                return

            employee_name = row[0]

            # Reject a check-in/check-out that doesn't follow the employee's
            # own last scan today (e.g. checking in twice in a row, or
            # checking out without having checked in) — otherwise anyone
            # could keep tapping the same button with no server-side guard.
            last_action_today = db.get_last_attendance_action_today(employee_id)
            if action == "CHECK_IN" and last_action_today == "CHECK_IN":
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": f"{employee_name} đã check-in rồi, vui lòng check-out trước khi check-in lại.",
                    },
                )
                return
            if action == "CHECK_OUT" and last_action_today != "CHECK_IN":
                self.send_json_response(
                    400,
                    {
                        "success": False,
                        "error": f"{employee_name} chưa check-in hôm nay, không thể check-out.",
                    },
                )
                return

            # Analyze emotion
            print("Analyzing emotion...", flush=True)
            with DEEPFACE_LOCK:
                analysis = DeepFace.analyze(
                    img_path=temp_img_path,
                    actions=["emotion"],
                    detector_backend=detector_backend,
                    enforce_detection=True,
                )

            dominant_emotion = "neutral"
            if isinstance(analysis, list) and len(analysis) > 0:
                dominant_emotion = analysis[0]["dominant_emotion"]
            elif isinstance(analysis, dict):
                dominant_emotion = analysis["dominant_emotion"]

            # Save file to logs
            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            audit_filepath = f"{LOGS_DIR}/{timestamp_str}_{action}_{employee_id}.jpg"
            os.rename(temp_img_path, audit_filepath)
            temp_img_path = None

            # Add Log to DB
            db.add_attendance_log(employee_id, action, dominant_emotion, audit_filepath)

            mood_text = MOOD_TRANSLATION.get(dominant_emotion, dominant_emotion)
            action_text = "Vào ca (Check-in)" if action == "CHECK_IN" else "Ra ca (Check-out)"

            self.send_json_response(
                200,
                {
                    "success": True,
                    "message": "Chấm công ghi nhận thành công!",
                    "data": {
                        "employee_name": employee_name,
                        "action": action_text,
                        "mood": mood_text,
                        "time": datetime.now().strftime("%H:%M:%S - %d/%m/%Y"),
                    },
                },
            )

        except ValueError as ve:
            print(f"Face error: {ve}", flush=True)
            self.send_json_response(
                400, {"success": False, "error": "Không tìm thấy khuôn mặt trong ảnh. Vui lòng chụp rõ mặt."}
            )
        except Exception as e:
            print(f"System error: {e}", flush=True)
            self.send_json_response(500, {"success": False, "error": str(e)})
        finally:
            if temp_img_path and os.path.exists(temp_img_path):
                os.remove(temp_img_path)

    def handle_get_logs(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            logs = db.get_attendance_logs()
            self.send_json_response(200, {"success": True, "data": logs})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_export_csv(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        try:
            logs = db.get_attendance_logs()

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["STT", "Mã NV", "Tên nhân viên", "Thời gian", "Hành động", "Cảm xúc"])

            for index, log in enumerate(logs):
                writer.writerow(
                    [index + 1, log["employee_id"], log["employee_name"], log["timestamp"], log["action"], log["mood"]]
                )

            csv_data = output.getvalue()
            output.close()

            # Stream CSV data
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8-sig")  # BOM for Excel Vietnamese compatibility
            self.send_header("Content-Disposition", 'attachment; filename="attendance_report.csv"')
            self.end_headers()

            self.wfile.write(csv_data.encode("utf-8-sig"))
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_promote_position(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            title = data.get("title")
            start_date = data.get("start_date", datetime.now().date().isoformat())

            if not title:
                self.send_json_response(400, {"success": False, "error": "Thiếu thông tin chức danh mới."})
                return

            db.promote_employee_position(employee_id, title, start_date)
            self.send_json_response(200, {"success": True, "message": "Ghi nhận thông tin bổ nhiệm mới thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_adjust_income(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            amount = float(data.get("amount", 0))
            effective_date = data.get("effective_date", datetime.now().date().isoformat())
            change_reason = data.get("change_reason", "HR Adjustment")

            if amount <= 0:
                self.send_json_response(400, {"success": False, "error": "Mức lương điều chỉnh phải lớn hơn 0."})
                return

            db.add_employee_income(employee_id, amount, effective_date, change_reason)
            self.send_json_response(200, {"success": True, "message": "Ghi nhận điều chỉnh mức lương thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_create_leave_request(self):
        # Self-service only: an employee submits a leave request for themselves.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            if user["employee_id"] != employee_id:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            start_date = data.get("start_date")
            end_date = data.get("end_date")
            reason = (data.get("reason") or "").strip()

            if not start_date or not end_date or not reason:
                self.send_json_response(400, {"success": False, "error": "Vui lòng nhập đầy đủ ngày nghỉ và lý do."})
                return

            if end_date < start_date:
                self.send_json_response(400, {"success": False, "error": "Ngày kết thúc phải sau ngày bắt đầu."})
                return

            db.create_leave_request(employee_id, start_date, end_date, reason)
            self.send_json_response(200, {"success": True, "message": "Gửi đơn xin nghỉ thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_leave_requests(self):
        # Admins can view any employee's leave requests; staff may only view their own.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            if user["role"] != "admin" and user["employee_id"] != employee_id:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            requests = db.get_leave_requests(employee_id)
            self.send_json_response(200, {"success": True, "data": requests})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_all_leave_requests(self):
        # Admin-only: the full review queue across every employee.
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            requests = db.get_all_leave_requests()
            self.send_json_response(200, {"success": True, "data": requests})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_update_leave_request_status(self):
        # Admin-only: approve or reject a submitted leave request.
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            request_id = int(self.path.split("/")[-1])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            status = data.get("status")
            rejection_reason = data.get("rejection_reason")
            if status not in ("pending", "approved", "rejected"):
                self.send_json_response(400, {"success": False, "error": "Trạng thái không hợp lệ."})
                return

            db.update_leave_request_status(request_id, status, rejection_reason)
            self.send_json_response(200, {"success": True, "message": "Cập nhật trạng thái đơn nghỉ thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_update_skills(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            skills_list = json.loads(post_data.decode("utf-8"))

            db.update_employee_skills(employee_id, skills_list)
            self.send_json_response(200, {"success": True, "message": "Cập nhật hồ sơ kỹ năng thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_update_projects(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            projects_list = json.loads(post_data.decode("utf-8"))

            db.update_employee_projects(employee_id, projects_list)
            self.send_json_response(200, {"success": True, "message": "Cập nhật lịch sử dự án thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_position(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            position_id = int(self.path.split("/")[-1])
            db.delete_employee_position(position_id)
            self.send_json_response(200, {"success": True, "message": "Xóa chức vụ thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_income(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            income_id = int(self.path.split("/")[-1])
            db.delete_employee_income(income_id)
            self.send_json_response(200, {"success": True, "message": "Xóa lịch sử thu nhập thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_all_documents(self):
        # Admin-only: every uploaded HR document across every employee.
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            documents = db.get_all_documents()
            self.send_json_response(200, {"success": True, "data": documents})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_employee_documents(self):
        # Admins can view any employee's documents; staff may only view their
        # own scope (broadcast "chung" docs plus their own "rieng" ones —
        # already filtered server-side by db.get_documents_for_employee).
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            employee_id = int(self.path.split("/")[-2])
            if user["role"] != "admin" and user["employee_id"] != employee_id:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            documents = db.get_documents_for_employee(employee_id)
            self.send_json_response(200, {"success": True, "data": documents})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_create_document(self):
        # Admin-only: upload a new HR document, broadcast ("chung") or scoped
        # to one employee ("rieng") — either an uploaded file or a pasted
        # external link. Streamed via real multipart/form-data (python-multipart),
        # the one exception to this app's base64-in-JSON upload convention,
        # since documents can legitimately be gigabytes (MAX_DOCUMENT_BYTES) —
        # holding the whole payload in memory the way every other upload does
        # isn't viable at that size.
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return

        content_type_header = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type_header:
            self.send_json_response(
                400, {"success": False, "error": "Yêu cầu không hợp lệ (thiếu multipart/form-data)."}
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json_response(400, {"success": False, "error": "Thiếu Content-Length hợp lệ."})
            return

        # Cheap upfront rejection before streaming a single byte to disk — a
        # multipart request is Content-Length + a little overhead (boundaries,
        # part headers) larger than the file itself, so this generous margin
        # still catches anything meaningfully over the real cap.
        if content_length > MAX_DOCUMENT_BYTES + (1024 * 1024):
            self.send_json_response(
                400, {"success": False, "error": "File tài liệu vượt quá dung lượng cho phép (5GB)."}
            )
            return

        fields = {}
        uploaded_file = {}

        def on_field(field):
            name = field.field_name.decode("utf-8")
            fields[name] = field.value.decode("utf-8") if field.value is not None else ""

        def on_file(file):
            uploaded_file["file"] = file

        try:
            parser = multipart.create_form_parser(
                {"Content-Type": content_type_header.encode("utf-8")},
                on_field,
                on_file,
                config={"MAX_MEMORY_FILE_SIZE": 1024 * 1024, "UPLOAD_DELETE_TMP": False},
            )
            bytes_read = 0
            while bytes_read < content_length:
                chunk = self.rfile.read(min(1024 * 1024, content_length - bytes_read))
                if not chunk:
                    break
                parser.write(chunk)
                bytes_read += len(chunk)
            parser.finalize()
        except Exception as e:
            self.send_json_response(400, {"success": False, "error": f"Không thể phân tích dữ liệu tải lên: {e}"})
            return

        uploaded = uploaded_file.get("file")

        title = (fields.get("title") or "").strip()
        visibility = fields.get("visibility")
        employee_id = fields.get("employee_id") or None
        source_type = fields.get("source_type") or "file"
        external_url = (fields.get("external_url") or "").strip()

        if employee_id is not None:
            try:
                employee_id = int(employee_id)
            except ValueError:
                employee_id = None

        if not title:
            self.send_json_response(400, {"success": False, "error": "Thiếu tiêu đề tài liệu."})
            return
        if visibility not in ("chung", "rieng"):
            self.send_json_response(400, {"success": False, "error": "Loại tài liệu không hợp lệ."})
            return
        if visibility == "rieng" and not employee_id:
            self.send_json_response(400, {"success": False, "error": "Vui lòng chọn nhân viên nhận tài liệu riêng."})
            return
        if visibility == "chung":
            employee_id = None
        if source_type not in ("file", "link"):
            self.send_json_response(400, {"success": False, "error": "Nguồn tài liệu không hợp lệ."})
            return

        if source_type == "link":
            if uploaded is not None:
                uploaded.close()
            if not external_url.lower().startswith(ALLOWED_EXTERNAL_URL_SCHEMES):
                self.send_json_response(
                    400, {"success": False, "error": "Liên kết phải bắt đầu bằng http:// hoặc https://."}
                )
                return
            try:
                document_id = db.create_document(
                    title, None, visibility, employee_id, source_type="link", external_url=external_url
                )
                self.send_json_response(
                    200, {"success": True, "message": "Đã thêm liên kết tài liệu.", "id": document_id}
                )
            except Exception as e:
                self.send_json_response(500, {"success": False, "error": str(e)})
            return

        # source_type == "file"
        if uploaded is None or not uploaded.file_name:
            self.send_json_response(400, {"success": False, "error": "File tài liệu trống hoặc không hợp lệ."})
            return

        file_name = uploaded.file_name.decode("utf-8")
        ext = os.path.splitext(file_name)[1].lower()
        if ext not in DOCUMENT_CONTENT_TYPES:
            uploaded.close()
            if not uploaded.in_memory:
                os.remove(uploaded.actual_file_name.decode("utf-8"))
            self.send_json_response(400, {"success": False, "error": "Định dạng file không được hỗ trợ."})
            return
        if uploaded.size == 0 or uploaded.size > MAX_DOCUMENT_BYTES:
            uploaded.close()
            if not uploaded.in_memory:
                os.remove(uploaded.actual_file_name.decode("utf-8"))
            self.send_json_response(
                400,
                {"success": False, "error": "File tài liệu trống hoặc vượt quá dung lượng cho phép (5GB)."},
            )
            return

        document_id = None
        try:
            document_id = db.create_document(title, file_name, visibility, employee_id, source_type="file")
            output_path = os.path.join(DOCUMENTS_DIR, f"{document_id}{ext}")
            if uploaded.in_memory:
                data = uploaded.file_object.getvalue()
                uploaded.close()
                with open(output_path, "wb") as out:
                    out.write(data)
            else:
                uploaded.close()
                shutil.move(uploaded.actual_file_name.decode("utf-8"), output_path)
            db.set_document_file_path(document_id, output_path)

            self.send_json_response(
                200, {"success": True, "message": "Tải lên tài liệu thành công.", "id": document_id}
            )
        except Exception as e:
            if document_id is not None:
                db.delete_document(document_id)
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_document(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            document_id = int(self.path.split("/")[-1])
            db.delete_document(document_id)
            self.send_json_response(200, {"success": True, "message": "Xóa tài liệu thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_create_message(self):
        # Any authenticated employee can message any other employee — no
        # manager/hierarchy restriction, recipient is a free pick.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            recipient_id = data.get("recipient_id")
            category = data.get("category")
            subject = (data.get("subject") or "").strip()
            content = (data.get("content") or "").strip()

            if not recipient_id or not subject or is_rich_content_empty(content):
                self.send_json_response(
                    400, {"success": False, "error": "Vui lòng chọn người nhận, tiêu đề và nội dung."}
                )
                return
            if category not in db.MESSAGE_CATEGORIES:
                self.send_json_response(400, {"success": False, "error": "Loại tin nhắn không hợp lệ."})
                return
            if not db.get_employee_basic(recipient_id):
                self.send_json_response(400, {"success": False, "error": "Người nhận không tồn tại."})
                return

            message_id = db.create_message(user["employee_id"], recipient_id, category, subject, content)
            self.send_json_response(200, {"success": True, "message": "Gửi tin nhắn thành công.", "id": message_id})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_upload_message_image(self):
        # Any authenticated employee — used by the shape-drawing tool inside
        # the message/template rich text editor. Not tied to a specific
        # message/template id (the image may be inserted before the message
        # is ever saved), so it's just a standalone file upload.
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            img_base64 = data.get("img")
            if not img_base64:
                self.send_json_response(400, {"success": False, "error": "Thiếu dữ liệu hình ảnh."})
                return
            if not image_within_size_limit(img_base64):
                self.send_json_response(
                    400, {"success": False, "error": "Hình vẽ vượt quá dung lượng cho phép (tối đa 8MB)."}
                )
                return

            filename = f"{uuid.uuid4().hex}.png"
            output_path = os.path.join(MESSAGE_IMAGES_DIR, filename)
            if save_base64_image(img_base64, output_path):
                self.send_json_response(200, {"success": True, "data": {"url": f"/uploads/messages/{filename}"}})
            else:
                self.send_json_response(500, {"success": False, "error": "Không thể lưu hình vẽ."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_received_messages(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            messages = db.get_received_messages(user["employee_id"])
            self.send_json_response(200, {"success": True, "data": messages})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_sent_messages(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            messages = db.get_sent_messages(user["employee_id"])
            self.send_json_response(200, {"success": True, "data": messages})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_message_detail(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            message_id = int(self.path.split("/")[-1])
            message = db.get_message(message_id)
            if not message:
                self.send_json_response(404, {"success": False, "error": "Không tìm thấy tin nhắn."})
                return
            is_sender = message["sender_id"] == user["employee_id"]
            is_recipient = message["recipient_id"] == user["employee_id"]
            if not is_sender and not is_recipient:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return
            # A message the caller has soft-deleted from their own side is
            # gone as far as they're concerned, even though the other party
            # may still see it.
            if (is_sender and message["deleted_by_sender"]) or (is_recipient and message["deleted_by_recipient"]):
                self.send_json_response(404, {"success": False, "error": "Không tìm thấy tin nhắn."})
                return
            message.pop("deleted_by_sender", None)
            message.pop("deleted_by_recipient", None)
            self.send_json_response(200, {"success": True, "data": message})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_message(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            message_id = int(self.path.split("/")[-1])
            message = db.get_message(message_id)
            if not message:
                self.send_json_response(404, {"success": False, "error": "Không tìm thấy tin nhắn."})
                return
            is_sender = message["sender_id"] == user["employee_id"]
            is_recipient = message["recipient_id"] == user["employee_id"]
            if not is_sender and not is_recipient:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            db.delete_message_for_employee(message_id, user["employee_id"])
            self.send_json_response(200, {"success": True, "message": "Đã xóa tin nhắn."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_mark_message_read(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            message_id = int(self.path.split("/")[-2])
            message = db.get_message(message_id)
            if not message:
                self.send_json_response(404, {"success": False, "error": "Không tìm thấy tin nhắn."})
                return
            if message["recipient_id"] != user["employee_id"]:
                self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
                return

            db.mark_message_read(message_id)
            self.send_json_response(200, {"success": True, "message": "Đã đánh dấu đọc."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_get_message_templates(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            templates = db.get_message_templates()
            self.send_json_response(200, {"success": True, "data": templates})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_create_message_template(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            category = data.get("category")
            name = (data.get("name") or "").strip()
            content = (data.get("content") or "").strip()

            if category not in db.MESSAGE_CATEGORIES:
                self.send_json_response(400, {"success": False, "error": "Loại tin nhắn không hợp lệ."})
                return
            if not name or is_rich_content_empty(content):
                self.send_json_response(400, {"success": False, "error": "Vui lòng nhập tên và nội dung mẫu."})
                return

            template_id = db.create_message_template(category, name, content)
            self.send_json_response(
                200, {"success": True, "message": "Tạo mẫu tin nhắn thành công.", "id": template_id}
            )
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_update_message_template(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            template_id = int(self.path.split("/")[-1])
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            category = data.get("category")
            name = (data.get("name") or "").strip()
            content = (data.get("content") or "").strip()

            if category not in db.MESSAGE_CATEGORIES:
                self.send_json_response(400, {"success": False, "error": "Loại tin nhắn không hợp lệ."})
                return
            if not name or is_rich_content_empty(content):
                self.send_json_response(400, {"success": False, "error": "Vui lòng nhập tên và nội dung mẫu."})
                return

            db.update_message_template(template_id, category, name, content)
            self.send_json_response(200, {"success": True, "message": "Cập nhật mẫu tin nhắn thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_delete_message_template(self):
        user = self.get_authenticated_user()
        if not user or user["role"] != "admin":
            self.send_json_response(401, {"success": False, "error": "Unauthorized access"})
            return
        try:
            template_id = int(self.path.split("/")[-1])
            db.delete_message_template(template_id)
            self.send_json_response(200, {"success": True, "message": "Xóa mẫu tin nhắn thành công."})
        except Exception as e:
            self.send_json_response(500, {"success": False, "error": str(e)})

    def handle_download_document(self):
        user = self.get_authenticated_user()
        if not user:
            self.send_error(401, "Unauthorized")
            return
        try:
            document_id = int(self.path.split("/")[-2])
        except (ValueError, IndexError):
            self.send_error(404, "Not Found")
            return

        document = db.get_document(document_id)
        if not document:
            self.send_error(404, "Document Not Found")
            return

        is_owner = document["employee_id"] == user["employee_id"]
        is_broadcast = document["visibility"] == "chung"
        if user["role"] != "admin" and not is_owner and not is_broadcast:
            self.send_error(401, "Unauthorized")
            return

        if document["source_type"] == "link":
            # No local file to serve — redirect to the external URL, still
            # gated behind the same authorization checks above.
            self.send_response(302)
            self.send_header("Location", document["external_url"])
            self.end_headers()
            return

        self._serve_local_file(
            DOCUMENTS_DIR,
            os.path.basename(document["file_path"]),
            content_type_map=DOCUMENT_CONTENT_TYPES,
            download_name=document["file_name"],
        )

    def send_json_response(self, status_code, payload):
        # default=str covers non-JSON-native values from psycopg2 (e.g. a
        # `datetime.date` for date_of_birth), serializing them the same way
        # str() would (a date becomes its 'YYYY-MM-DD' isoformat).
        response_bytes = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(response_bytes)


def run(server_class=ThreadingHTTPServer, handler_class=EmployeeFaceAIRequestHandler, port=8000):
    print("Connecting to PostgreSQL and verifying schemas...", flush=True)
    db.init_db()
    start_log_retention_thread()

    server_address = ("", port)
    httpd = server_class(server_address, handler_class)
    print(f"Starting server on port {port}...", flush=True)
    print(f"Local URL: http://localhost:{port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print("Server stopped.", flush=True)


if __name__ == "__main__":
    run()
