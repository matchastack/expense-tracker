#!/usr/bin/env python3
"""
Database setup script for SplitWiser application.
This script creates the database and initializes the schema.
"""

import psycopg2
from psycopg2 import sql
import sys
import os
from pathlib import Path

def create_database(admin_config, db_name):
    """Create the database if it doesn't exist."""
    try:
        conn = psycopg2.connect(**admin_config)
        conn.autocommit = True
        cursor = conn.cursor()
        
        # Check if database exists
        cursor.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (db_name,)
        )
        
        if cursor.fetchone():
            print(f"Database '{db_name}' already exists.")
            return True
        
        # Create database
        cursor.execute(sql.SQL("CREATE DATABASE {}").format(
            sql.Identifier(db_name)
        ))
        print(f"Database '{db_name}' created successfully.")
        return True
        
    except Exception as e:
        print(f"Error creating database: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

def run_init_script(db_config, script_path):
    """Run the initialization SQL script."""
    try:
        with open(script_path, 'r') as f:
            sql_script = f.read()
        
        conn = psycopg2.connect(**db_config)
        cursor = conn.cursor()
        
        cursor.execute(sql_script)
        conn.commit()
        
        print("Database schema initialized successfully.")
        return True
        
    except Exception as e:
        print(f"Error initializing database schema: {e}")
        if 'conn' in locals():
            conn.rollback()
        return False
    finally:
        if 'conn' in locals():
            conn.close()

def main():
    print("SplitWiser Database Setup")
    print("=" * 50)
    
    # Get database configuration
    db_host = input("PostgreSQL host (default: localhost): ").strip() or "localhost"
    db_port = input("PostgreSQL port (default: 5432): ").strip() or "5432"
    db_user = input("PostgreSQL admin user (default: postgres): ").strip() or "postgres"
    db_password = input("PostgreSQL admin password: ").strip()
    db_name = input("Database name to create (default: splitwise_db): ").strip() or "splitwise_db"
    
    # Admin connection config (connects to postgres database)
    admin_config = {
        'host': db_host,
        'port': db_port,
        'user': db_user,
        'password': db_password,
        'dbname': 'postgres'
    }
    
    # Create database
    print(f"\nCreating database '{db_name}'...")
    if not create_database(admin_config, db_name):
        print("Failed to create database. Exiting.")
        return 1
    
    # Target database config
    db_config = admin_config.copy()
    db_config['dbname'] = db_name
    
    # Find init_db.sql
    script_path = Path(__file__).parent / 'init_db.sql'
    if not script_path.exists():
        script_path = Path(__file__).parent.parent / 'init_db.sql'
    
    if not script_path.exists():
        print(f"Error: Could not find init_db.sql at {script_path}")
        return 1
    
    # Run initialization script
    print(f"\nInitializing database schema...")
    if not run_init_script(db_config, script_path):
        print("Failed to initialize database schema. Exiting.")
        return 1
    
    # Create .env file
    env_path = Path(__file__).parent / '.env'
    with open(env_path, 'w') as f:
        f.write(f"DB_HOST={db_host}\n")
        f.write(f"DB_PORT={db_port}\n")
        f.write(f"DB_USER={db_user}\n")
        f.write(f"DB_PASSWORD={db_password}\n")
        f.write(f"DB_NAME={db_name}\n")
    
    print(f"\nConfiguration saved to {env_path}")
    print("\nDatabase setup completed successfully!")
    print(f"\nYou can now run the application with: streamlit run src/app.py")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
    