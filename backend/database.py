import sqlite3
from datetime import datetime


DATABASE_NAME = "city_brain.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_NAME)
    connection.row_factory = sqlite3.Row
    return connection


def init_database():

    connection = get_connection()
    cursor = connection.cursor()

    # Roads table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS roads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            vehicle_count INTEGER NOT NULL,
            average_speed REAL NOT NULL,
            congestion TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN'
        )
    """)

    # Incidents table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            road TEXT NOT NULL,
            incident_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            status TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)

    # Optional geographic coordinates are stored separately to preserve the existing incidents schema.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS incident_locations (
            incident_id INTEGER PRIMARY KEY,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            location_label TEXT,
            FOREIGN KEY(incident_id) REFERENCES incidents(id)
        )
    """)

    # Traffic history
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS traffic_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            road TEXT NOT NULL,
            vehicle_count INTEGER NOT NULL,
            average_speed REAL NOT NULL,
            congestion TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)

    connection.commit()
    connection.close()


# ---------------- ROADS ----------------

def get_all_roads():

    connection = get_connection()

    rows = connection.execute(
        "SELECT * FROM roads ORDER BY id"
    ).fetchall()

    connection.close()

    return [dict(row) for row in rows]


def get_road(road_name):

    connection = get_connection()

    row = connection.execute(
        "SELECT * FROM roads WHERE name = ?",
        (road_name,)
    ).fetchone()

    connection.close()

    if row:
        return dict(row)

    return None


def add_road(
    name,
    vehicle_count,
    average_speed,
    congestion,
    status="OPEN"
):

    connection = get_connection()

    connection.execute("""
        INSERT OR IGNORE INTO roads
        (name, vehicle_count, average_speed, congestion, status)
        VALUES (?, ?, ?, ?, ?)
    """, (
        name,
        vehicle_count,
        average_speed,
        congestion,
        status
    ))

    connection.commit()
    connection.close()


def update_road(
    name,
    vehicle_count,
    average_speed,
    congestion,
    status=None
):

    connection = get_connection()

    if status is None:

        connection.execute("""
            UPDATE roads
            SET vehicle_count = ?,
                average_speed = ?,
                congestion = ?
            WHERE name = ?
        """, (
            vehicle_count,
            average_speed,
            congestion,
            name
        ))

    else:

        connection.execute("""
            UPDATE roads
            SET vehicle_count = ?,
                average_speed = ?,
                congestion = ?,
                status = ?
            WHERE name = ?
        """, (
            vehicle_count,
            average_speed,
            congestion,
            status,
            name
        ))

    connection.commit()
    connection.close()

    return get_road(name)


# ---------------- INCIDENTS ----------------

def add_incident(
    road,
    incident_type,
    severity,
    status
):

    connection = get_connection()

    connection.execute("""
        INSERT INTO incidents
        (road, incident_type, severity, status, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (
        road,
        incident_type,
        severity,
        status,
        datetime.now().isoformat()
    ))

    connection.commit()
    connection.close()


def get_all_incidents():

    connection = get_connection()

    rows = connection.execute("""
        SELECT *
        FROM incidents
        ORDER BY id DESC
    """).fetchall()

    connection.close()

    return [dict(row) for row in rows]


def update_incident_status(incident_id, status):

    connection = get_connection()

    connection.execute("""
        UPDATE incidents
        SET status = ?
        WHERE id = ?
    """, (
        status,
        incident_id
    ))

    connection.commit()
    connection.close()


# ---------------- TRAFFIC HISTORY ----------------

def save_traffic_history(road):

    connection = get_connection()

    connection.execute("""
        INSERT INTO traffic_history
        (road, vehicle_count, average_speed,
         congestion, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (
        road["name"],
        road["vehicle_count"],
        road["average_speed"],
        road["congestion"],
        datetime.now().isoformat()
    ))

    connection.commit()
    connection.close()

# ---------------- TRAFFIC HISTORY READ ----------------

def get_traffic_history(limit=1000):
    connection = get_connection()
    rows = connection.execute("""
        SELECT road, vehicle_count, average_speed, congestion, timestamp
        FROM traffic_history
        ORDER BY id DESC
        LIMIT ?
    """, (limit,)).fetchall()
    connection.close()

    history = []
    for row in rows:
        item = dict(row)
        try:
            item["ts"] = int(datetime.fromisoformat(item["timestamp"]).timestamp() * 1000)
        except Exception:
            item["ts"] = 0
        history.append(item)
    return history


def set_incident_location(incident_id, latitude, longitude, location_label=None):
    connection = get_connection()
    connection.execute("""
        INSERT INTO incident_locations (incident_id, latitude, longitude, location_label)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(incident_id) DO UPDATE SET latitude=excluded.latitude,
            longitude=excluded.longitude, location_label=excluded.location_label
    """, (incident_id, latitude, longitude, location_label))
    connection.commit()
    connection.close()


def get_incident_locations():
    connection = get_connection()
    rows = connection.execute("""
        SELECT incident_id, latitude, longitude, location_label
        FROM incident_locations ORDER BY incident_id
    """).fetchall()
    connection.close()
    return [dict(row) for row in rows]
