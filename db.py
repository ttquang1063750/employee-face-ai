import psycopg2
from psycopg2.extras import RealDictCursor
import time
import secrets
from datetime import datetime, timedelta

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "mysecretpassword",
    "dbname": "employee_face_ai"
}

def get_connection():
    retries = 5
    while retries > 0:
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            return conn
        except psycopg2.OperationalError as e:
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
                age INTEGER NOT NULL,
                image_path VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'staff',
                password VARCHAR(100) DEFAULT NULL,
                username VARCHAR(50) UNIQUE DEFAULT NULL
            );
        """)
        # 1b. Migration for databases created before the username column existed
        cur.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;")
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
        print("Database schemas initialized.", flush=True)

        # Seed data if database is empty
        seed_mock_data(conn)

        # Backfill a login username for the admin account so the system stays
        # bootstrappable now that login requires a username (not just ID + password).
        # Runs after seeding so it also covers databases seeded before this column existed.
        cur.execute("UPDATE employees SET username = 'admin' WHERE role = 'admin' AND username IS NULL;")
        conn.commit()

    except Exception as e:
        conn.rollback()
        print(f"Error initializing database: {e}", flush=True)
        raise e
    finally:
        cur.close()
        conn.close()

def seed_mock_data(conn):
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) FROM employees;")
        count = cur.fetchone()[0]
        if count > 0:
            print("Database already contains data. Skipping seeding.", flush=True)
            return

        print("Seeding mock employee database with lifecycles...", flush=True)

        # 1. Seed Admin
        cur.execute("""
            INSERT INTO employees (name, age, image_path, role, password)
            VALUES (%s, %s, %s, %s, %s) RETURNING id;
        """, ("HR Admin", 36, "database/1.jpg", "admin", "admin"))
        admin_id = cur.fetchone()[0]

        cur.execute("""
            INSERT INTO employee_positions (employee_id, title, start_date)
            VALUES (%s, %s, %s);
        """, (admin_id, "HR Director", "2023-01-01"))

        cur.execute("""
            INSERT INTO employee_skills (employee_id, skill_name, description)
            VALUES (%s, %s, %s), (%s, %s, %s);
        """, (
            admin_id, "HR Management", "Over 10 years of human resource planning and lifecycle optimization",
            admin_id, "Talent Acquisition", "Experienced in hiring elite engineers for high-tech robotics departments"
        ))

        cur.execute("""
            INSERT INTO employee_income_history (employee_id, amount, effective_date, change_reason)
            VALUES (%s, %s, %s, %s);
        """, (admin_id, 7500.00, "2023-01-01", "Initial Offer"))

        # 2. Seed Developer (John Doe)
        cur.execute("""
            INSERT INTO employees (name, age, image_path, role, password)
            VALUES (%s, %s, %s, %s, %s) RETURNING id;
        """, ("Nguyễn Văn Trỗi", 29, "database/2.jpg", "staff", None))
        dev_id = cur.fetchone()[0]

        # Positions history (Promotion)
        cur.execute("""
            INSERT INTO employee_positions (employee_id, title, start_date, end_date)
            VALUES (%s, %s, %s, %s);
        """, (dev_id, "Junior Web Developer", "2024-01-01", "2025-06-30"))
        
        cur.execute("""
            INSERT INTO employee_positions (employee_id, title, start_date, end_date)
            VALUES (%s, %s, %s, %s);
        """, (dev_id, "Senior Web Developer", "2025-07-01", None))

        # Skills Registry with descriptions
        cur.execute("""
            INSERT INTO employee_skills (employee_id, skill_name, description)
            VALUES 
            (%s, %s, %s),
            (%s, %s, %s),
            (%s, %s, %s);
        """, (
            dev_id, "Angular", "Expert in Standalone Components, Signal state stores, and Custom RxJS Interceptors.",
            dev_id, "Python & OpenCV", "Experienced in building high-frequency REST APIs and processing facial computer vision nodes.",
            dev_id, "PostgreSQL", "Designing normalized database schemas and tuning indexes for fast queries."
        ))

        # Projects Assignment History with descriptions
        cur.execute("""
            INSERT INTO employee_projects (employee_id, project_name, role, description, start_date, end_date)
            VALUES 
            (%s, %s, %s, %s, %s, %s),
            (%s, %s, %s, %s, %s, %s);
        """, (
            dev_id, "Employee Face AI", "Lead Angular Developer", "Engineered the biometric scan kiosk interface using modern Angular signals and SCSS panels.", "2026-06-01", None,
            dev_id, "Robotics Arm Controller", "Embedded Programmer", "Programmed real-time target-tracking visual filters using OpenCV and C++.", "2024-03-01", "2025-05-01"
        ))

        # Income Compensation History (Raises)
        cur.execute("""
            INSERT INTO employee_income_history (employee_id, amount, effective_date, change_reason)
            VALUES 
            (%s, %s, %s, %s),
            (%s, %s, %s, %s),
            (%s, %s, %s, %s);
        """, (
            dev_id, 3200.00, "2024-01-01", "Onboarding Junior Offer",
            dev_id, 3800.00, "2025-01-01", "Annual Performance Review",
            dev_id, 5400.00, "2025-07-01", "Promotion to Senior Web Developer"
        ))

        # 3. Seed another employee (Jane)
        cur.execute("""
            INSERT INTO employees (name, age, image_path, role, password)
            VALUES (%s, %s, %s, %s, %s) RETURNING id;
        """, ("Trần Thị Hương", 26, "database/3.jpg", "staff", None))
        jane_id = cur.fetchone()[0]

        cur.execute("""
            INSERT INTO employee_positions (employee_id, title, start_date)
            VALUES (%s, %s, %s);
        """, (jane_id, "Robotics Engineer", "2024-06-15"))

        cur.execute("""
            INSERT INTO employee_skills (employee_id, skill_name, description)
            VALUES 
            (%s, %s, %s),
            (%s, %s, %s);
        """, (
            jane_id, "C++ & ROS", "Programming kinetic arm path trajectories using ROS2 Humble and C++.",
            jane_id, "MATLAB", "Simulating sensor noise and testing Kalman filter tracking matrices."
        ))

        cur.execute("""
            INSERT INTO employee_projects (employee_id, project_name, role, description, start_date, end_date)
            VALUES (%s, %s, %s, %s, %s, %s);
        """, (jane_id, "Warehouse Autonomous AGV", "Kinematics Engineer", "Developed coordinate transform modules for multi-wheel steering AGVs.", "2024-07-01", None))

        cur.execute("""
            INSERT INTO employee_income_history (employee_id, amount, effective_date, change_reason)
            VALUES 
            (%s, %s, %s, %s),
            (%s, %s, %s, %s);
        """, (
            jane_id, 4000.00, "2024-06-15", "Onboarding Robotics Engineer",
            jane_id, 4500.00, "2025-06-15", "Annual Performance Review"
        ))

        conn.commit()
        print("Mock data seeded successfully.", flush=True)
    except Exception as e:
        conn.rollback()
        print(f"Error seeding mock data: {e}", flush=True)
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

        cur.execute("""
            INSERT INTO user_sessions (session_token, refresh_token, employee_id, access_expires_at, refresh_expires_at)
            VALUES (%s, %s, %s, %s, %s);
        """, (session_token, refresh_token, employee_id, access_expires, refresh_expires))
        
        conn.commit()
        return {
            "access_token": session_token,
            "refresh_token": refresh_token,
            "access_expires_at": access_expires.isoformat(),
            "refresh_expires_at": refresh_expires.isoformat()
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
        cur.execute("""
            SELECT s.employee_id, e.name, e.role, s.access_expires_at
            FROM user_sessions s
            JOIN employees e ON s.employee_id = e.id
            WHERE s.session_token = %s;
        """, (session_token,))
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
        cur.execute("""
            SELECT employee_id, refresh_expires_at FROM user_sessions
            WHERE refresh_token = %s;
        """, (refresh_token_val,))
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
        cur.execute("SELECT id FROM employees WHERE username = %s AND password = %s;", (username, password))
        row = cur.fetchone()
        return row[0] if row else None
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

def register_employee(name, age, image_path, role='staff', password=None, username=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO employees (name, age, image_path, role, password, username)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;
        """, (name, age, image_path, role, password, username))
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
        cur.execute("""
            INSERT INTO employee_skills (employee_id, skill_name, description)
            VALUES (%s, %s, %s);
        """, (employee_id, skill_name, description))
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
        cur.execute("""
            INSERT INTO employee_positions (employee_id, title, start_date, end_date)
            VALUES (%s, %s, %s, %s);
        """, (employee_id, title, start_date, end_date))
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
        cur.execute("""
            INSERT INTO employee_projects (employee_id, project_name, role, description, start_date, end_date)
            VALUES (%s, %s, %s, %s, %s, %s);
        """, (employee_id, project_name, role, description, start_date, end_date))
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
        cur.execute("""
            INSERT INTO employee_income_history (employee_id, amount, effective_date, change_reason)
            VALUES (%s, %s, %s, %s);
        """, (employee_id, amount, effective_date, change_reason))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()

def update_employee_profile(employee_id, name, age, role, username, password=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        if password:
            cur.execute("""
                UPDATE employees
                SET name = %s, age = %s, role = %s, username = %s, password = %s
                WHERE id = %s;
            """, (name, age, role, username, password, employee_id))
        else:
            cur.execute("""
                UPDATE employees
                SET name = %s, age = %s, role = %s, username = %s
                WHERE id = %s;
            """, (name, age, role, username, employee_id))
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
        cur.execute("SELECT id FROM employees WHERE id = %s AND password = %s;", (employee_id, password))
        return cur.fetchone() is not None
    finally:
        cur.close()
        conn.close()

def update_employee_password(employee_id, new_password):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE employees SET password = %s WHERE id = %s;", (new_password, employee_id))
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
        cur.execute("""
            INSERT INTO employee_leave_requests (employee_id, start_date, end_date, reason)
            VALUES (%s, %s, %s, %s) RETURNING id;
        """, (employee_id, start_date, end_date, reason))
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
        cur.execute("""
            SELECT id, start_date, end_date, reason, status, requested_at, rejection_reason
            FROM employee_leave_requests
            WHERE employee_id = %s
            ORDER BY requested_at DESC;
        """, (employee_id,))
        rows = cur.fetchall()
        for r in rows:
            r['start_date'] = r['start_date'].isoformat()
            r['end_date'] = r['end_date'].isoformat()
            r['requested_at'] = r['requested_at'].isoformat()
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
            r['start_date'] = r['start_date'].isoformat()
            r['end_date'] = r['end_date'].isoformat()
            r['requested_at'] = r['requested_at'].isoformat()
        return rows
    finally:
        cur.close()
        conn.close()

def update_leave_request_status(request_id, status, rejection_reason=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE employee_leave_requests 
            SET status = %s, rejection_reason = %s 
            WHERE id = %s;
        """, (status, rejection_reason, request_id))
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
            SELECT e.id, e.name, e.age, e.image_path, e.role,
                   (SELECT title FROM employee_positions WHERE employee_id = e.id AND end_date IS NULL LIMIT 1) as current_position
            FROM employees e
            ORDER BY e.id DESC;
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
        cur.execute("""
            SELECT id, name, age, image_path, role, username
            FROM employees WHERE id = %s;
        """, (employee_id,))
        emp = cur.fetchone()
        cur.close()
        if not emp:
            return None

        # Current Position
        cur = conn.cursor()
        cur.execute("SELECT title FROM employee_positions WHERE employee_id = %s AND end_date IS NULL LIMIT 1;", (employee_id,))
        pos_row = cur.fetchone()
        emp["current_position"] = pos_row[0] if pos_row else "Unassigned"
        cur.close()

        # Skills List
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT skill_name, description FROM employee_skills WHERE employee_id = %s ORDER BY id;", (employee_id,))
        emp["skills"] = cur.fetchall()
        cur.close()

        # Positions history
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT id, title, start_date, end_date 
            FROM employee_positions WHERE employee_id = %s ORDER BY start_date DESC;
        """, (employee_id,))
        emp["positions"] = cur.fetchall()
        for p in emp["positions"]:
            p['start_date'] = p['start_date'].isoformat()
            if p['end_date']:
                p['end_date'] = p['end_date'].isoformat()
        cur.close()

        # Projects history
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT id, project_name, role, description, start_date, end_date 
            FROM employee_projects WHERE employee_id = %s ORDER BY start_date DESC;
        """, (employee_id,))
        emp["projects"] = cur.fetchall()
        for prj in emp["projects"]:
            prj['start_date'] = prj['start_date'].isoformat()
            if prj['end_date']:
                prj['end_date'] = prj['end_date'].isoformat()
        cur.close()

        # Income history
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT id, amount, effective_date, change_reason 
            FROM employee_income_history WHERE employee_id = %s ORDER BY effective_date DESC;
        """, (employee_id,))
        emp["income_history"] = cur.fetchall()
        for inc in emp["income_history"]:
            inc['amount'] = float(inc['amount'])
            inc['effective_date'] = inc['effective_date'].isoformat()
        cur.close()

        # Custom Month Check-In Summary (Grouped by month/year)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT TO_CHAR(timestamp, 'YYYY-MM') as month,
                   COUNT(CASE WHEN action = 'CHECK_IN' THEN 1 END) as check_ins,
                   COUNT(CASE WHEN action = 'CHECK_OUT' THEN 1 END) as check_outs
            FROM attendance_logs
            WHERE employee_id = %s
            GROUP BY month
            ORDER BY month DESC;
        """, (employee_id,))
        emp["monthly_logs_summary"] = cur.fetchall()
        cur.close()

        # Raw attendance logs for detailed analytics
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT timestamp, action, mood
            FROM attendance_logs
            WHERE employee_id = %s
            ORDER BY timestamp DESC;
        """, (employee_id,))
        emp["raw_logs"] = cur.fetchall()
        for log in emp["raw_logs"]:
            log['timestamp'] = log['timestamp'].isoformat()
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
            (employee_id, action, mood, captured_image_path)
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
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
            if log['timestamp']:
                log['timestamp'] = log['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
        return logs
    finally:
        cur.close()
        conn.close()

def promote_employee_position(employee_id, title, start_date):
    conn = get_connection()
    cur = conn.cursor()
    try:
        # Terminate active position
        cur.execute("""
            UPDATE employee_positions 
            SET end_date = %s 
            WHERE employee_id = %s AND end_date IS NULL;
        """, (start_date, employee_id))
        
        # Insert new position
        cur.execute("""
            INSERT INTO employee_positions (employee_id, title, start_date)
            VALUES (%s, %s, %s);
        """, (employee_id, title, start_date))
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
            cur.execute("""
                INSERT INTO employee_skills (employee_id, skill_name, description)
                VALUES (%s, %s, %s);
            """, (employee_id, sk['skill_name'], sk['description']))
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
            cur.execute("""
                INSERT INTO employee_projects (employee_id, project_name, role, description, start_date, end_date)
                VALUES (%s, %s, %s, %s, %s, %s);
            """, (employee_id, prj['project_name'], prj['role'], prj['description'], prj['start_date'], prj.get('end_date')))
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
