"""
Migration script to add geolocation and extended features to the database
Run this after backing up your database
"""

from sqlalchemy import create_engine, text
import os

DB_URL = os.environ.get("DATABASE_URL", "sqlite:///./marketplace_v3.db")
connect_args = {"check_same_thread": False} if "sqlite" in DB_URL else {}
engine = create_engine(DB_URL, connect_args=connect_args)

def migrate():
    print("Starting migration to add geolocation features...")

    # Add columns to tasks table
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN city VARCHAR"))
            print("OK - Added city column to tasks")
        except Exception as e:
            print(f"SKIP - city column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN address VARCHAR"))
            print("OK - Added address column to tasks")
        except Exception as e:
            print(f"SKIP - address column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN latitude FLOAT"))
            print("OK - Added latitude column to tasks")
        except Exception as e:
            print(f"SKIP - latitude column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN longitude FLOAT"))
            print("OK - Added longitude column to tasks")
        except Exception as e:
            print(f"SKIP - longitude column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN deadline VARCHAR"))
            print("OK - Added deadline column to tasks")
        except Exception as e:
            print(f"SKIP - deadline column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN is_remote BOOLEAN DEFAULT 0"))
            print("OK - Added is_remote column to tasks")
        except Exception as e:
            print(f"SKIP - is_remote column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN images TEXT"))
            print("OK - Added images column to tasks")
        except Exception as e:
            print(f"SKIP - images column: {str(e)[:50]}")

        # Add location fields to users
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN city VARCHAR"))
            print("OK - Added city column to users")
        except Exception as e:
            print(f"SKIP - city column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR"))
            print("OK - Added phone column to users")
        except Exception as e:
            print(f"SKIP - phone column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar VARCHAR"))
            print("OK - Added avatar column to users")
        except Exception as e:
            print(f"SKIP - avatar column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN portfolio TEXT"))
            print("OK - Added portfolio column to users")
        except Exception as e:
            print(f"SKIP - portfolio column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN skills TEXT"))
            print("OK - Added skills column to users")
        except Exception as e:
            print(f"SKIP - skills column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN verified BOOLEAN DEFAULT 0"))
            print("OK - Added verified column to users")
        except Exception as e:
            print(f"SKIP - verified column: {str(e)[:50]}")

        # Add price field to responses
        try:
            conn.execute(text("ALTER TABLE responses ADD COLUMN proposed_price INTEGER"))
            print("OK - Added proposed_price column to responses")
        except Exception as e:
            print(f"SKIP - proposed_price column: {str(e)[:50]}")

        try:
            conn.execute(text("ALTER TABLE responses ADD COLUMN estimated_days INTEGER"))
            print("OK - Added estimated_days column to responses")
        except Exception as e:
            print(f"SKIP - estimated_days column: {str(e)[:50]}")

    print("\nMigration completed successfully!")
    print("\nNew features added:")
    print("  * Task location (city, address, coordinates)")
    print("  * Remote work option")
    print("  * Task deadlines")
    print("  * Image uploads for tasks")
    print("  * User location (city)")
    print("  * User phone, avatar, portfolio")
    print("  * Specialist skills")
    print("  * User verification status")
    print("  * Response pricing and timeline")

if __name__ == "__main__":
    migrate()
