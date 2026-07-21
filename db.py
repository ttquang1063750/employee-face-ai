import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

# Loads .env (repo root, gitignored) into os.environ — credentials never live
# in source, only in this untracked file (see .env.example for the template).
# Falls back to docker-compose.yml's defaults so a fresh clone still runs
# without requiring a .env first; anyone who cares about the password not
# being a checked-in default should create one.
load_dotenv()

DB_CONFIG = {
    "host": os.environ.get("POSTGRES_HOST", "localhost"),
    "port": int(os.environ.get("POSTGRES_PORT", "5432")),
    "user": os.environ.get("POSTGRES_USER", "postgres"),
    "password": os.environ.get("POSTGRES_PASSWORD", "mysecretpassword"),
    "dbname": os.environ.get("POSTGRES_DB", "employee_face_ai"),
}

PBKDF2_ITERATIONS = 260_000

# Fixed set of employee_messages.category / message_templates.category values.
# Not a DB-managed lookup table — these are classification labels only (no
# scheduling/reminders attached to them), so server.py validates writes
# against this single source of truth instead of a CHECK constraint.
MESSAGE_CATEGORIES = ("daily_report", "weekly_report", "monthly_report", "other")


def hash_password(plain_password):
    """Hash a plaintext password for storage (PBKDF2-HMAC-SHA256, random salt
    per password). Returns None unchanged so callers can pass through a
    staff account that has no login access yet."""
    if not plain_password:
        return None
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def _check_password(plain_password, stored_value):
    """Constant-time check of a plaintext password against a stored value.
    Also accepts a legacy plaintext row as a safety net in case a row
    somehow bypasses the startup migration in migrate_legacy_passwords."""
    if not stored_value or not plain_password:
        return False
    parts = stored_value.split("$")
    if len(parts) == 4 and parts[0] == "pbkdf2_sha256":
        _, iterations, salt, hash_hex = parts
        digest = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(digest.hex(), hash_hex)
    return hmac.compare_digest(stored_value, plain_password)


def migrate_legacy_passwords(conn):
    """One-time upgrade: hash any password still stored in plaintext from
    before hashing was introduced. Safe to run on every startup — rows
    already hashed (prefixed pbkdf2_sha256$) are skipped."""
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, password FROM employees WHERE password IS NOT NULL AND password NOT LIKE 'pbkdf2_sha256$%';"
        )
        rows = cur.fetchall()
        for employee_id, plain in rows:
            cur.execute("UPDATE employees SET password = %s WHERE id = %s;", (hash_password(plain), employee_id))
        if rows:
            conn.commit()
            print(f"Migrated {len(rows)} legacy plaintext password(s) to hashed storage.", flush=True)
    finally:
        cur.close()


def migrate_upload_paths(conn):
    """One-time upgrade: every uploaded/captured file used to live under its
    own top-level folder (`database/`, `logs/`, `documents/`); they're now
    all nested under a single `uploads/` root (see AGENTS.md's Unified
    Uploads Root rule) so runtime data isn't scattered across the repo root.
    Safe to run on every startup — a path already under `uploads/` is left
    alone, so this is a no-op once every row has been migrated once."""
    cur = conn.cursor()
    try:
        migrated = 0
        cur.execute(
            "UPDATE employees SET image_path = 'uploads/' || image_path "
            "WHERE image_path IS NOT NULL AND image_path NOT LIKE 'uploads/%';"
        )
        migrated += cur.rowcount
        cur.execute(
            "UPDATE attendance_logs SET captured_image_path = 'uploads/' || captured_image_path "
            "WHERE captured_image_path IS NOT NULL AND captured_image_path NOT LIKE 'uploads/%';"
        )
        migrated += cur.rowcount
        cur.execute(
            "UPDATE employee_documents SET file_path = 'uploads/' || file_path "
            "WHERE file_path IS NOT NULL AND file_path != '' AND file_path NOT LIKE 'uploads/%';"
        )
        migrated += cur.rowcount
        if migrated:
            conn.commit()
            print(f"Migrated {migrated} file path(s) to the unified uploads/ root.", flush=True)
    finally:
        cur.close()


def get_connection():
    retries = 5
    while retries > 0:
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            return conn
        except psycopg2.OperationalError:
            retries -= 1
            print(f"Postgres not ready, retrying in 2 seconds... ({retries} retries left)", flush=True)
            time.sleep(2)
    raise Exception("Could not connect to PostgreSQL database.")


def init_db():
    conn = get_connection()
    cur = conn.cursor()
    try:
        # 1. Base employees table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                date_of_birth DATE,
                image_path VARCHAR(255),
                role VARCHAR(20) DEFAULT 'staff',
                password VARCHAR(100) DEFAULT NULL,
                username VARCHAR(50) UNIQUE DEFAULT NULL
            );
        """)
        # 1b. Migration for databases created before the username column existed
        cur.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;")
        # 1c. Widen password column to fit a PBKDF2 hash (salt + digest), which
        # is longer than the plaintext passwords the column was sized for.
        cur.execute("ALTER TABLE employees ALTER COLUMN password TYPE VARCHAR(255);")
        # 1d. Migration from the old required `age` (INTEGER) column to a
        # nullable `date_of_birth` (DATE), needed to support birthday alerts.
        # There's no reliable way to convert an existing age into a real
        # birthdate, so existing rows simply get NULL until an admin re-enters
        # it via the edit-profile form.
        cur.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;")
        cur.execute("ALTER TABLE employees DROP COLUMN IF EXISTS age;")
        # 1e. image_path is no longer required at insert time — the bootstrap
        # admin account (see bootstrap_admin_account) has no reference photo
        # until someone captures one via the edit-profile modal. The frontend
        # already falls back to a placeholder icon for a missing/broken photo
        # (see avatarUrl()/onImageError() in image.util.ts).
        cur.execute("ALTER TABLE employees ALTER COLUMN image_path DROP NOT NULL;")
        conn.commit()
        # 2. employee_skills
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_skills (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                skill_name VARCHAR(100) NOT NULL,
                description TEXT
            );
        """)
        # 3. employee_positions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_positions (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                title VARCHAR(100) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE DEFAULT NULL
            );
        """)
        # 4. employee_projects
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_projects (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                project_name VARCHAR(100) NOT NULL,
                role VARCHAR(100) NOT NULL,
                description TEXT,
                start_date DATE NOT NULL,
                end_date DATE DEFAULT NULL
            );
        """)
        # 5. employee_income_history
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_income_history (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                amount NUMERIC(12, 2) NOT NULL,
                effective_date DATE NOT NULL,
                change_reason VARCHAR(255) NOT NULL
            );
        """)
        # 6. user_sessions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_token VARCHAR(255) PRIMARY KEY,
                refresh_token VARCHAR(255) UNIQUE NOT NULL,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                access_expires_at TIMESTAMP NOT NULL,
                refresh_expires_at TIMESTAMP NOT NULL
            );
        """)
        # 7. attendance_logs
        cur.execute("""
            CREATE TABLE IF NOT EXISTS attendance_logs (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                action VARCHAR(20) NOT NULL,
                mood VARCHAR(50) NOT NULL,
                captured_image_path VARCHAR(255)
            );
        """)
        # 8. employee_leave_requests
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_leave_requests (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                rejection_reason TEXT DEFAULT NULL
            );
        """)
        cur.execute("ALTER TABLE employee_leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT NULL;")
        conn.commit()
        # 9. employee_documents — employee_id is nullable (the one FK column in
        # this schema that is), since a "chung" (broadcast) doc has no single
        # owner. The CHECK keeps visibility and employee_id from drifting apart.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_documents (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                file_path VARCHAR(255) NOT NULL,
                visibility VARCHAR(20) NOT NULL DEFAULT 'rieng',
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHECK (
                    (visibility = 'chung' AND employee_id IS NULL)
                    OR (visibility = 'rieng' AND employee_id IS NOT NULL)
                )
            );
        """)
        # A document is either an uploaded file (source_type='file', the
        # original behavior) or a pasted external link (source_type='link',
        # e.g. a video hosted elsewhere) — file_name/file_path are only
        # populated for the former, external_url only for the latter. Kept
        # as a Python-side invariant (handle_create_document), not a new DB
        # CHECK, mirroring how visibility/employee_id is already validated
        # in both places — adding a CHECK to a live table needs a
        # pg_constraint existence guard that isn't worth the risk here.
        cur.execute(
            "ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS source_type VARCHAR(10) NOT NULL DEFAULT 'file';"
        )
        cur.execute("ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS external_url VARCHAR(2048);")
        cur.execute("ALTER TABLE employee_documents ALTER COLUMN file_name DROP NOT NULL;")
        cur.execute("ALTER TABLE employee_documents ALTER COLUMN file_path DROP NOT NULL;")
        conn.commit()
        conn.commit()
        # 10. employee_messages — free-form internal messages between any two
        # employees (not just staff->admin), with a fixed `category` enum
        # (MESSAGE_CATEGORIES below) rather than a separate lookup table,
        # since categories are just classification labels, not a managed entity.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                recipient_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                category VARCHAR(50) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        # Per-side soft delete: each party can hide the message from their own
        # list without affecting the other party's copy. Once both sides have
        # deleted it, the row itself is purged (see delete_message_for_employee).
        cur.execute(
            "ALTER TABLE employee_messages ADD COLUMN IF NOT EXISTS deleted_by_sender BOOLEAN NOT NULL DEFAULT FALSE;"
        )
        cur.execute(
            "ALTER TABLE employee_messages ADD COLUMN IF NOT EXISTS deleted_by_recipient BOOLEAN NOT NULL DEFAULT FALSE;"
        )
        # 11. message_templates — global (no employee_id): any employee can use
        # any template when composing, but only an admin can create/edit/delete
        # one (enforced in server.py, not here).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS message_templates (
                id SERIAL PRIMARY KEY,
                category VARCHAR(50) NOT NULL,
                name VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        print("Database schemas initialized.", flush=True)

        # Bootstrap the initial admin login if the database is empty
        bootstrap_admin_account(conn)

        # Backfill a login username for the admin account so the system stays
        # bootstrappable now that login requires a username (not just ID + password).
        # Runs after bootstrapping so it also covers databases seeded before this
        # column existed.
        cur.execute("UPDATE employees SET username = 'admin' WHERE role = 'admin' AND username IS NULL;")
        conn.commit()

        migrate_legacy_passwords(conn)
        migrate_upload_paths(conn)

    except Exception as e:
        conn.rollback()
        print(f"Error initializing database: {e}", flush=True)
        raise e
    finally:
        cur.close()
        conn.close()


def bootstrap_admin_account(conn):
    """Creates the one starting login a fresh instance needs — no demo
    employees, positions, skills, or projects. Credentials come from
    ADMIN_USERNAME/ADMIN_PASSWORD (see .env.example), falling back to
    admin/admin so a fresh clone still runs with zero setup. image_path and
    date_of_birth are left NULL; the admin fills those in later via the
    edit-profile modal (avatarUrl()/onImageError() already handle a missing
    photo)."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) FROM employees;")
        count = cur.fetchone()[0]
        if count > 0:
            print("Database already contains employees. Skipping admin bootstrap.", flush=True)
            return

        admin_username = os.environ.get("ADMIN_USERNAME", "admin")
        admin_password = os.environ.get("ADMIN_PASSWORD", "admin")

        print(f"Bootstrapping initial admin account ('{admin_username}')...", flush=True)
        cur.execute(
            """
            INSERT INTO employees (name, role, username, password)
            VALUES (%s, %s, %s, %s);
        """,
            ("Admin", "admin", admin_username, hash_password(admin_password)),
        )

        conn.commit()
        print("Admin account bootstrapped successfully.", flush=True)
    except Exception as e:
        conn.rollback()
        print(f"Error bootstrapping admin account: {e}", flush=True)
        raise e
    finally:
        cur.close()


def create_session(employee_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        session_token = secrets.token_hex(32)
        refresh_token = secrets.token_hex(32)

        # Access token expires in 15 minutes, Refresh token in 7 days
        access_expires = datetime.now() + timedelta(minutes=15)
        refresh_expires = datetime.now() + timedelta(days=7)

        cur.execute(
            """
            INSERT INTO user_sessions (session_token, refresh_token, employee_id, access_expires_at, refresh_expires_at)
            VALUES (%s, %s, %s, %s, %s);
        """,
            (session_token, refresh_token, employee_id, access_expires, refresh_expires),
        )

        conn.commit()
        return {
            "access_token": session_token,
            "refresh_token": refresh_token,
            "access_expires_at": access_expires.isoformat(),
            "refresh_expires_at": refresh_expires.isoformat(),
        }
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def verify_session(session_token):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT s.employee_id, e.name, e.role, s.access_expires_at
            FROM user_sessions s
            JOIN employees e ON s.employee_id = e.id
            WHERE s.session_token = %s;
        """,
            (session_token,),
        )
        row = cur.fetchone()
        if not row:
            return None

        # Check if expired
        if datetime.now() > row["access_expires_at"]:
            return None

        return row
    finally:
        cur.close()
        conn.close()


def refresh_session(refresh_token_val):
    conn = get_connection()
    cur = conn.cursor()
    try:
        # Check if refresh token exists and not expired
        cur.execute(
            """
            SELECT employee_id, refresh_expires_at FROM user_sessions
            WHERE refresh_token = %s;
        """,
            (refresh_token_val,),
        )
        row = cur.fetchone()
        if not row:
            return None

        employee_id, refresh_expires = row
        if datetime.now() > refresh_expires:
            # Delete expired session
            cur.execute("DELETE FROM user_sessions WHERE refresh_token = %s;", (refresh_token_val,))
            conn.commit()
            return None

        # Delete old session and generate new tokens
        cur.execute("DELETE FROM user_sessions WHERE refresh_token = %s;", (refresh_token_val,))
        conn.commit()
        cur.close()
        conn.close()

        # Create fresh session
        return create_session(employee_id)
    except Exception as e:
        conn.rollback()
        raise e


def revoke_session(session_token):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM user_sessions WHERE session_token = %s;", (session_token,))
        conn.commit()
    finally:
        cur.close()
        conn.close()


def verify_login_credentials(username, password):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, password FROM employees WHERE username = %s;", (username,))
        row = cur.fetchone()
        if not row or not _check_password(password, row[1]):
            return None
        return row[0]
    finally:
        cur.close()
        conn.close()


def username_exists(username, exclude_id=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        if exclude_id:
            cur.execute("SELECT id FROM employees WHERE username = %s AND id != %s;", (username, exclude_id))
        else:
            cur.execute("SELECT id FROM employees WHERE username = %s;", (username,))
        return cur.fetchone() is not None
    finally:
        cur.close()
        conn.close()


def get_employee_basic(employee_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, name, role FROM employees WHERE id = %s;", (employee_id,))
        return cur.fetchone()
    finally:
        cur.close()
        conn.close()


def register_employee(name, date_of_birth, image_path, role="staff", password=None, username=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employees (name, date_of_birth, image_path, role, password, username)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;
        """,
            (name, date_of_birth, image_path, role, hash_password(password), username),
        )
        emp_id = cur.fetchone()[0]
        conn.commit()
        return emp_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def add_employee_skills(employee_id, skill_name, description):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_skills (employee_id, skill_name, description)
            VALUES (%s, %s, %s);
        """,
            (employee_id, skill_name, description),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def add_employee_position(employee_id, title, start_date, end_date=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_positions (employee_id, title, start_date, end_date)
            VALUES (%s, %s, %s, %s);
        """,
            (employee_id, title, start_date, end_date),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def add_employee_project(employee_id, project_name, role, description, start_date, end_date=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_projects (employee_id, project_name, role, description, start_date, end_date)
            VALUES (%s, %s, %s, %s, %s, %s);
        """,
            (employee_id, project_name, role, description, start_date, end_date),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def add_employee_income(employee_id, amount, effective_date, change_reason):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_income_history (employee_id, amount, effective_date, change_reason)
            VALUES (%s, %s, %s, %s);
        """,
            (employee_id, amount, effective_date, change_reason),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def update_employee_profile(employee_id, name, date_of_birth, role, username, password=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        if password:
            cur.execute(
                """
                UPDATE employees
                SET name = %s, date_of_birth = %s, role = %s, username = %s, password = %s
                WHERE id = %s;
            """,
                (name, date_of_birth, role, username, hash_password(password), employee_id),
            )
        else:
            cur.execute(
                """
                UPDATE employees
                SET name = %s, date_of_birth = %s, role = %s, username = %s
                WHERE id = %s;
            """,
                (name, date_of_birth, role, username, employee_id),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def verify_password(employee_id, password):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT password FROM employees WHERE id = %s;", (employee_id,))
        row = cur.fetchone()
        return _check_password(password, row[0]) if row else False
    finally:
        cur.close()
        conn.close()


def update_employee_password(employee_id, new_password):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE employees SET password = %s WHERE id = %s;", (hash_password(new_password), employee_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def update_employee_avatar(employee_id, image_path):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE employees SET image_path = %s WHERE id = %s;", (image_path, employee_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def create_leave_request(employee_id, start_date, end_date, reason):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_leave_requests (employee_id, start_date, end_date, reason)
            VALUES (%s, %s, %s, %s) RETURNING id;
        """,
            (employee_id, start_date, end_date, reason),
        )
        request_id = cur.fetchone()[0]
        conn.commit()
        return request_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_leave_requests(employee_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT id, start_date, end_date, reason, status, requested_at, rejection_reason
            FROM employee_leave_requests
            WHERE employee_id = %s
            ORDER BY requested_at DESC;
        """,
            (employee_id,),
        )
        rows = cur.fetchall()
        for r in rows:
            r["start_date"] = r["start_date"].isoformat()
            r["end_date"] = r["end_date"].isoformat()
            r["requested_at"] = r["requested_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def get_all_leave_requests():
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT lr.id, lr.employee_id, e.name AS employee_name,
                   (SELECT title FROM employee_positions WHERE employee_id = e.id AND end_date IS NULL LIMIT 1) AS current_position,
                   lr.start_date, lr.end_date, lr.reason, lr.status, lr.requested_at, lr.rejection_reason
            FROM employee_leave_requests lr
            JOIN employees e ON lr.employee_id = e.id
            ORDER BY (lr.status = 'pending') DESC, lr.requested_at DESC;
        """)
        rows = cur.fetchall()
        for r in rows:
            r["start_date"] = r["start_date"].isoformat()
            r["end_date"] = r["end_date"].isoformat()
            r["requested_at"] = r["requested_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def update_leave_request_status(request_id, status, rejection_reason=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE employee_leave_requests
            SET status = %s, rejection_reason = %s
            WHERE id = %s;
        """,
            (status, rejection_reason, request_id),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def create_document(title, file_name, visibility, employee_id=None, source_type="file", external_url=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_documents
                (employee_id, title, file_name, file_path, visibility, source_type, external_url)
            VALUES (%s, %s, %s, '', %s, %s, %s) RETURNING id;
        """,
            (employee_id, title, file_name, visibility, source_type, external_url),
        )
        document_id = cur.fetchone()[0]
        conn.commit()
        return document_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def set_document_file_path(document_id, file_path):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE employee_documents SET file_path = %s WHERE id = %s;", (file_path, document_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_all_documents():
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT d.id, d.employee_id, e.name AS employee_name, d.title, d.file_name,
                   d.source_type, d.external_url, d.visibility, d.uploaded_at
            FROM employee_documents d
            LEFT JOIN employees e ON d.employee_id = e.id
            ORDER BY d.uploaded_at DESC;
        """)
        rows = cur.fetchall()
        for r in rows:
            r["uploaded_at"] = r["uploaded_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def get_documents_for_employee(employee_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT d.id, d.employee_id, e.name AS employee_name, d.title, d.file_name,
                   d.source_type, d.external_url, d.visibility, d.uploaded_at
            FROM employee_documents d
            LEFT JOIN employees e ON d.employee_id = e.id
            WHERE d.visibility = 'chung' OR d.employee_id = %s
            ORDER BY d.uploaded_at DESC;
        """,
            (employee_id,),
        )
        rows = cur.fetchall()
        for r in rows:
            r["uploaded_at"] = r["uploaded_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def get_document(document_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT id, employee_id, title, file_name, file_path, source_type, external_url,
                   visibility, uploaded_at
            FROM employee_documents WHERE id = %s;
        """,
            (document_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def delete_document(document_id):
    import os

    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT file_path FROM employee_documents WHERE id = %s;", (document_id,))
        row = cur.fetchone()
        file_path = row[0] if row else None

        cur.execute("DELETE FROM employee_documents WHERE id = %s;", (document_id,))
        conn.commit()

        if file_path:
            abs_path = os.path.abspath(file_path)
            if os.path.isfile(abs_path):
                try:
                    os.remove(abs_path)
                    print(f"Deleted document file: {abs_path}", flush=True)
                except Exception as e:
                    print(f"Failed to delete document file: {abs_path}, error: {str(e)}", flush=True)
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def create_message(sender_id, recipient_id, category, subject, content):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO employee_messages (sender_id, recipient_id, category, subject, content)
            VALUES (%s, %s, %s, %s, %s) RETURNING id;
        """,
            (sender_id, recipient_id, category, subject, content),
        )
        message_id = cur.fetchone()[0]
        conn.commit()
        return message_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_received_messages(employee_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT m.id, m.sender_id, e.name AS sender_name, m.category, m.subject,
                   m.content, m.is_read, m.created_at
            FROM employee_messages m
            JOIN employees e ON m.sender_id = e.id
            WHERE m.recipient_id = %s AND m.deleted_by_recipient = FALSE
            ORDER BY m.created_at DESC;
        """,
            (employee_id,),
        )
        rows = cur.fetchall()
        for r in rows:
            r["created_at"] = r["created_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def get_sent_messages(employee_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT m.id, m.recipient_id, e.name AS recipient_name, m.category, m.subject,
                   m.content, m.is_read, m.created_at
            FROM employee_messages m
            JOIN employees e ON m.recipient_id = e.id
            WHERE m.sender_id = %s AND m.deleted_by_sender = FALSE
            ORDER BY m.created_at DESC;
        """,
            (employee_id,),
        )
        rows = cur.fetchall()
        for r in rows:
            r["created_at"] = r["created_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def get_message(message_id):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT m.id, m.sender_id, sender.name AS sender_name,
                   m.recipient_id, recipient.name AS recipient_name,
                   m.category, m.subject, m.content, m.is_read, m.created_at,
                   m.deleted_by_sender, m.deleted_by_recipient
            FROM employee_messages m
            JOIN employees sender ON m.sender_id = sender.id
            JOIN employees recipient ON m.recipient_id = recipient.id
            WHERE m.id = %s;
        """,
            (message_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        row["created_at"] = row["created_at"].isoformat()
        return dict(row)
    finally:
        cur.close()
        conn.close()


def mark_message_read(message_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE employee_messages SET is_read = TRUE WHERE id = %s;", (message_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def delete_message_for_employee(message_id, employee_id):
    """Marks the message deleted on whichever side `employee_id` is on
    (sender or recipient, one atomic UPDATE covers both since a row's
    sender_id/recipient_id can't both equal employee_id). Once both sides
    have deleted it, the row is purged rather than left as an orphaned
    all-deleted soft-delete row."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            UPDATE employee_messages
            SET deleted_by_sender = deleted_by_sender OR (sender_id = %(employee_id)s),
                deleted_by_recipient = deleted_by_recipient OR (recipient_id = %(employee_id)s)
            WHERE id = %(message_id)s
            RETURNING deleted_by_sender, deleted_by_recipient;
        """,
            {"employee_id": employee_id, "message_id": message_id},
        )
        row = cur.fetchone()
        if row and row["deleted_by_sender"] and row["deleted_by_recipient"]:
            cur.execute("DELETE FROM employee_messages WHERE id = %s;", (message_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_message_templates():
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT id, category, name, content, created_at
            FROM message_templates
            ORDER BY category, name;
        """)
        rows = cur.fetchall()
        for r in rows:
            r["created_at"] = r["created_at"].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()


def create_message_template(category, name, content):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO message_templates (category, name, content)
            VALUES (%s, %s, %s) RETURNING id;
        """,
            (category, name, content),
        )
        template_id = cur.fetchone()[0]
        conn.commit()
        return template_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def update_message_template(template_id, category, name, content):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE message_templates
            SET category = %s, name = %s, content = %s
            WHERE id = %s;
        """,
            (category, name, content, template_id),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def delete_message_template(template_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM message_templates WHERE id = %s;", (template_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def delete_employee_profile(employee_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        # Get image path first to delete the file
        cur.execute("SELECT image_path FROM employees WHERE id = %s;", (employee_id,))
        row = cur.fetchone()

        # Cascade deletes
        cur.execute("DELETE FROM employees WHERE id = %s;", (employee_id,))
        conn.commit()

        return row[0] if row else None
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_all_employees():
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Select base employee details along with their current position
        cur.execute("""
            SELECT e.id, e.name, e.date_of_birth, e.image_path, e.role, e.username,
                   (SELECT title FROM employee_positions WHERE employee_id = e.id AND end_date IS NULL LIMIT 1) as current_position
            FROM employees e
            ORDER BY e.id DESC;
        """)
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


def get_employee_directory():
    """Minimal, non-admin-gated employee list — just enough for picking a
    message recipient by name (id, name, current position; `id` also lets the
    picker disambiguate same-named employees without exposing anyone's
    username — half of a login credential — to every authenticated
    employee). Deliberately excludes username/role/photo, unlike
    get_all_employees() above (Admin only), so this can safely be exposed to
    any authenticated employee."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT e.id, e.name,
                   (SELECT title FROM employee_positions WHERE employee_id = e.id AND end_date IS NULL LIMIT 1) as current_position
            FROM employees e
            ORDER BY e.name;
        """)
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


def get_detailed_employee(employee_id):
    conn = get_connection()
    try:
        # Base details
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, name, date_of_birth, image_path, role, username
            FROM employees WHERE id = %s;
        """,
            (employee_id,),
        )
        emp = cur.fetchone()
        cur.close()
        if not emp:
            return None

        # Current Position
        cur = conn.cursor()
        cur.execute(
            "SELECT title FROM employee_positions WHERE employee_id = %s AND end_date IS NULL LIMIT 1;", (employee_id,)
        )
        pos_row = cur.fetchone()
        emp["current_position"] = pos_row[0] if pos_row else "Unassigned"
        cur.close()

        # Skills List
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT skill_name, description FROM employee_skills WHERE employee_id = %s ORDER BY id;", (employee_id,)
        )
        emp["skills"] = cur.fetchall()
        cur.close()

        # Positions history
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, title, start_date, end_date
            FROM employee_positions WHERE employee_id = %s ORDER BY start_date DESC;
        """,
            (employee_id,),
        )
        emp["positions"] = cur.fetchall()
        for p in emp["positions"]:
            p["start_date"] = p["start_date"].isoformat()
            if p["end_date"]:
                p["end_date"] = p["end_date"].isoformat()
        cur.close()

        # Projects history
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, project_name, role, description, start_date, end_date
            FROM employee_projects WHERE employee_id = %s ORDER BY start_date DESC;
        """,
            (employee_id,),
        )
        emp["projects"] = cur.fetchall()
        for prj in emp["projects"]:
            prj["start_date"] = prj["start_date"].isoformat()
            if prj["end_date"]:
                prj["end_date"] = prj["end_date"].isoformat()
        cur.close()

        # Income history
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, amount, effective_date, change_reason
            FROM employee_income_history WHERE employee_id = %s ORDER BY effective_date DESC;
        """,
            (employee_id,),
        )
        emp["income_history"] = cur.fetchall()
        for inc in emp["income_history"]:
            inc["amount"] = float(inc["amount"])
            inc["effective_date"] = inc["effective_date"].isoformat()
        cur.close()

        # Custom Month Check-In Summary (Grouped by month/year)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT TO_CHAR(timestamp, 'YYYY-MM') as month,
                   COUNT(CASE WHEN action = 'CHECK_IN' THEN 1 END) as check_ins,
                   COUNT(CASE WHEN action = 'CHECK_OUT' THEN 1 END) as check_outs
            FROM attendance_logs
            WHERE employee_id = %s
            GROUP BY month
            ORDER BY month DESC;
        """,
            (employee_id,),
        )
        emp["monthly_logs_summary"] = cur.fetchall()
        cur.close()

        # Raw attendance logs for detailed analytics
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, timestamp, action, mood, captured_image_path
            FROM attendance_logs
            WHERE employee_id = %s
            ORDER BY timestamp DESC;
        """,
            (employee_id,),
        )
        emp["raw_logs"] = cur.fetchall()
        for log in emp["raw_logs"]:
            log["timestamp"] = log["timestamp"].isoformat()
        cur.close()

        return emp
    finally:
        conn.close()


def add_attendance_log(employee_id, action, mood, captured_image_path):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO attendance_logs (employee_id, action, mood, captured_image_path) VALUES (%s, %s, %s, %s);",
            (employee_id, action, mood, captured_image_path),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_last_attendance_action_today(employee_id):
    """Most recent CHECK_IN/CHECK_OUT action for this employee today, or None
    if they haven't scanned in yet today. Scoped to "today" rather than
    all-time so a forgotten check-out yesterday doesn't permanently lock the
    employee out of checking in again — there's no admin UI to fix/delete a
    stray attendance log, so each day effectively resets the state machine."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT action FROM attendance_logs
            WHERE employee_id = %s AND timestamp::date = CURRENT_DATE
            ORDER BY timestamp DESC
            LIMIT 1;
            """,
            (employee_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()
        conn.close()


def get_attendance_logs():
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                l.id,
                l.employee_id,
                e.name as employee_name,
                l.timestamp as timestamp,
                l.action,
                l.mood,
                l.captured_image_path
            FROM attendance_logs l
            JOIN employees e ON l.employee_id = e.id
            ORDER BY l.timestamp DESC;
        """)
        logs = cur.fetchall()
        for log in logs:
            if log["timestamp"]:
                log["timestamp"] = log["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
        return logs
    finally:
        cur.close()
        conn.close()


def promote_employee_position(employee_id, title, start_date):
    conn = get_connection()
    cur = conn.cursor()
    try:
        # Terminate active position
        cur.execute(
            """
            UPDATE employee_positions
            SET end_date = %s
            WHERE employee_id = %s AND end_date IS NULL;
        """,
            (start_date, employee_id),
        )

        # Insert new position
        cur.execute(
            """
            INSERT INTO employee_positions (employee_id, title, start_date)
            VALUES (%s, %s, %s);
        """,
            (employee_id, title, start_date),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def update_employee_skills(employee_id, skills_list):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM employee_skills WHERE employee_id = %s;", (employee_id,))
        for sk in skills_list:
            cur.execute(
                """
                INSERT INTO employee_skills (employee_id, skill_name, description)
                VALUES (%s, %s, %s);
            """,
                (employee_id, sk["skill_name"], sk["description"]),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def update_employee_projects(employee_id, projects_list):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM employee_projects WHERE employee_id = %s;", (employee_id,))
        for prj in projects_list:
            cur.execute(
                """
                INSERT INTO employee_projects (employee_id, project_name, role, description, start_date, end_date)
                VALUES (%s, %s, %s, %s, %s, %s);
            """,
                (
                    employee_id,
                    prj["project_name"],
                    prj["role"],
                    prj["description"],
                    prj["start_date"],
                    prj.get("end_date"),
                ),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def delete_employee_position(position_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM employee_positions WHERE id = %s;", (position_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def delete_employee_income(income_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM employee_income_history WHERE id = %s;", (income_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def delete_attendance_log(log_id):
    import os

    conn = get_connection()
    cur = conn.cursor()
    try:
        # Retrieve image path first to delete the file
        cur.execute("SELECT captured_image_path FROM attendance_logs WHERE id = %s;", (log_id,))
        row = cur.fetchone()
        img_path = row[0] if row else None

        cur.execute("DELETE FROM attendance_logs WHERE id = %s;", (log_id,))
        conn.commit()

        # Delete file if exists
        if img_path:
            abs_path = os.path.abspath(img_path)
            if os.path.isfile(abs_path):
                try:
                    os.remove(abs_path)
                    print(f"Deleted audit photo file: {abs_path}", flush=True)
                except Exception as e:
                    print(f"Failed to delete audit photo file: {abs_path}, error: {str(e)}", flush=True)
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()
