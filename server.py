import os

# Force TensorFlow to run strictly on CPU to avoid device hangs on macOS Apple Silicon
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import base64
import csv
import io
import json
import re
import tempfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from deepface import DeepFace

import db

# Min 8 chars, at least one lowercase, one uppercase, one digit, one special character
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$")

MOOD_TRANSLATION = {
    "happy": "Vui vẻ 😊",
    "sad": "Buồn bã 😢",
    "angry": "Tức giận 😠",
    "surprise": "Ngạc nhiên 😲",
    "fear": "Lo sợ 😨",
    "disgust": "Khó chịu 😣",
    "neutral": "Bình thường 😐",
}


def save_base64_image(base64_str, output_path):
    try:
        header, encoded = base64_str.split(",", 1)
        data = base64.b64decode(encoded)
        with open(output_path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        print(f"Error saving base64 image: {e}", flush=True)
        return False


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
        elif self.path == "/api/leave-requests":
            self.handle_get_all_leave_requests()
        elif self.path.startswith("/api/employees/check-username"):
            self.handle_check_username()
        elif self.path.startswith("/api/employees/") and self.path.endswith("/leave-requests"):
            self.handle_get_leave_requests()
        elif self.path.startswith("/api/employees/"):
            self.handle_get_employee_detail()
        elif self.path.startswith("/database/"):
            self.serve_database_image()
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
        elif self.path == "/api/attendance":
            self.handle_attendance()
        else:
            self.send_error(404, "Endpoint Not Found")

    def do_PUT(self):
        if self.path.startswith("/api/leave-requests/"):
            self.handle_update_leave_request_status()
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

    def serve_database_image(self):
        database_root = os.path.realpath("database")
        requested_path = os.path.realpath(os.path.join(database_root, self.path[len("/database/") :]))

        # Guard against path traversal outside the database directory
        if os.path.commonpath([database_root, requested_path]) != database_root:
            self.send_error(403, "Forbidden")
            return

        ext = os.path.splitext(requested_path)[1].lower()
        content_type = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}.get(ext)
        if not content_type:
            self.send_error(403, "Forbidden")
            return

        try:
            with open(requested_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_error(404, "File Not Found")

    def handle_login(self):
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            username = data.get("username")
            password = data.get("password")

            employee_id = db.verify_login_credentials(username, password)
            if employee_id:
                tokens = db.create_session(employee_id)
                user = db.get_employee_basic(employee_id)
                self.send_json_response(200, {"success": True, "tokens": tokens, "user": user})
            else:
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

            faces = DeepFace.extract_faces(img_path=temp_img_path, enforce_detection=True)
            return len(faces) > 0
        except Exception as e:
            print(f"Face detection failed: {e}", flush=True)
            return False
        finally:
            if temp_img_path and os.path.exists(temp_img_path):
                os.remove(temp_img_path)

    def find_duplicate_face(self, img_base64, exclude_id=None):
        """Returns (name, employee_id) if img_base64 already matches an existing
        employee's reference photo in database/ (other than exclude_id, used when
        an employee re-uploads/recaptures their own photo), else None. Never
        raises — any DeepFace failure (no face detected, empty database/, etc.)
        is treated as "no duplicate found" so it never blocks registration/edits
        on unrelated errors."""
        if not db.get_all_employees():
            return None

        temp_img_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_img_path = temp_file.name
            if not save_base64_image(img_base64, temp_img_path):
                return None

            dfs = DeepFace.find(img_path=temp_img_path, db_path="database", enforce_detection=False, silent=True)

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
            age = int(data.get("age", 30))
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
            temp_path = "database/temp.jpg"
            employee_id = db.register_employee(name, age, temp_path, role, password, username)

            # Final filepath
            final_filepath = f"database/{employee_id}.jpg"
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
            age = int(data.get("age", 30))
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
            db.update_employee_profile(employee_id, name, age, role, username, password)
            current_detail = db.get_detailed_employee(employee_id)
            today_str = datetime.now().date().isoformat()

            # 1b. Update reference avatar photo, if a new one was captured/uploaded
            if img_base64:
                final_filepath = f"database/{employee_id}.jpg"
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

            final_filepath = f"database/{employee_id}.jpg"
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

    def handle_attendance(self):
        temp_img_path = None
        try:
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            img_base64 = data.get("img")
            action = data.get("action")  # CHECK_IN or CHECK_OUT
            detector_backend = data.get("detector_backend", "retinaface")

            if not img_base64 or not action:
                self.send_json_response(
                    400, {"success": False, "error": "Thiếu dữ liệu chụp ảnh hoặc trạng thái chấm công."}
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
            dfs = DeepFace.find(
                img_path=temp_img_path, db_path="database", detector_backend=detector_backend, enforce_detection=True
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

            # Analyze emotion
            print("Analyzing emotion...", flush=True)
            analysis = DeepFace.analyze(
                img_path=temp_img_path, actions=["emotion"], detector_backend=detector_backend, enforce_detection=True
            )

            dominant_emotion = "neutral"
            if isinstance(analysis, list) and len(analysis) > 0:
                dominant_emotion = analysis[0]["dominant_emotion"]
            elif isinstance(analysis, dict):
                dominant_emotion = analysis["dominant_emotion"]

            # Save file to logs
            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            audit_filepath = f"logs/{timestamp_str}_{action}_{employee_id}.jpg"
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

    def send_json_response(self, status_code, payload):
        response_bytes = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(response_bytes)


def run(server_class=HTTPServer, handler_class=EmployeeFaceAIRequestHandler, port=8000):
    print("Connecting to PostgreSQL and verifying schemas...", flush=True)
    db.init_db()

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
