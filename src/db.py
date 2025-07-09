import psycopg2
from psycopg2 import sql
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DEFAULT_DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'splitwise_db'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5432')
}

def get_db_connection(db_config=None):
    """Establish a connection to the PostgreSQL database."""
    config = db_config or DEFAULT_DB_CONFIG
    try:
        conn = psycopg2.connect(**config)
        return conn
    except Exception as e:
        print(f"Error connecting to the database: {e}")
        return None

def execute_sql_script(script_path, db_config=None):
    """Execute a SQL script from a file."""
    conn = get_db_connection(db_config)
    if conn is None:
        return False

    try:
        with open(script_path, 'r') as sql_file:
            cursor = conn.cursor()
            cursor.execute(sql_file.read())
            conn.commit()
            print(f"Executed script: {script_path}")
            return True
    except Exception as e:
        print(f"Error executing script {script_path}: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def init_db(script_path='../init_db.sql', db_config=None):
    """Initialize the database by executing the SQL script."""
    return execute_sql_script(script_path, db_config)

def check_db_exists(db_config=None):
    """Check if the database exists and is accessible."""
    conn = get_db_connection(db_config)
    if conn:
        conn.close()
        return True
    return False

if __name__ == "__main__":
    if init_db():
        print("Database initialized successfully.")
    else:
        print("Failed to initialize database.")
        