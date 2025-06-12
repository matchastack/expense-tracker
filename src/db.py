import psycopg2
from psycopg2 import sql

def get_db_connection():
    """Establish a connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            dbname='expense_tracker',
            user='liauzhanyi',
            # password='',
            host='localhost',
            port='5432'
        )
        return conn
    except Exception as e:
        print(f"Error connecting to the database: {e}")
        return None

def execute_sql_script(script_path):
    """Execute a SQL script from a file."""
    conn = get_db_connection()
    if conn is None:
        return

    try:
        with open(script_path, 'r') as sql_file:
            cursor = conn.cursor()
            cursor.execute(sql_file.read())
            conn.commit()
            print(f"Executed script: {script_path}")
    except Exception as e:
        print(f"Error executing script {script_path}: {e}")
    finally:
        conn.close()

def init_db(script_path='../init_db.sql'):
    """Initialize the database by executing the SQL script."""
    execute_sql_script(script_path)

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
