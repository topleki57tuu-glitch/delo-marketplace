"""
Update existing tasks with geocoded coordinates
"""

import sqlite3
from geocoding import geocode_address

DB_PATH = "marketplace_v3.db"

def update_task_coordinates():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get tasks with city but no coordinates
    cursor.execute("""
        SELECT id, city, address
        FROM tasks
        WHERE city IS NOT NULL
        AND is_remote = 0
        AND (latitude IS NULL OR longitude IS NULL)
    """)

    tasks = cursor.fetchall()
    print(f"Found {len(tasks)} tasks to geocode")

    updated = 0
    for task_id, city, address in tasks:
        coords = geocode_address(city, address)
        if coords:
            latitude, longitude = coords
            cursor.execute("""
                UPDATE tasks
                SET latitude = ?, longitude = ?
                WHERE id = ?
            """, (latitude, longitude, task_id))
            print(f"  Task {task_id}: {city} coords: ({latitude:.4f}, {longitude:.4f})")
            updated += 1
        else:
            print(f"  Task {task_id}: {city} geocoding failed")

    conn.commit()
    conn.close()

    print(f"\nUpdated {updated}/{len(tasks)} tasks with coordinates")

if __name__ == "__main__":
    update_task_coordinates()
