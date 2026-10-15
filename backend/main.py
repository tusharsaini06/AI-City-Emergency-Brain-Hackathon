from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import asyncio

from fastapi import FastAPI, HTTPException, WebSocket, Query  # type: ignore[reportMissingImports]
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware  # type: ignore[reportMissingImports]

from database import (
    init_database,
    get_all_roads,
    get_road,
    update_road,
    add_incident,
    get_all_incidents,
    update_incident_status,
    save_traffic_history,
    get_traffic_history,
    set_incident_location, get_incident_locations,
)
from simulation import create_initial_traffic, simulate_accident
from models import TrafficUpdate, AccidentRequest, IncidentStatusUpdate
from ai_service import analyze_incident, explain_decision
from traffic_module import get_traffic_result
from geo_services import geocode, route as calculate_geo_route, GeoProviderError
from traffic_service import get_flow as get_live_traffic_flow, provider_status as live_traffic_provider_status, TrafficProviderError
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)
AI_RESULTS = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting AI City Emergency Brain...")
    init_database()
    create_initial_traffic()
    print("Database initialized successfully.")
    yield
    print("AI City Emergency Brain shutting down...")


app = FastAPI(
    title="AI City Emergency Brain",
    description="AI-powered city emergency and traffic management backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "AI City Emergency Brain Backend is running"}


@app.get("/health")
def health():
    import os
    return {"status": "ok", "service": "AI City Emergency Brain",
            "ai_provider": "Gemini configured" if os.getenv("GEMINI_API_KEY") else "DEMO RULES (GEMINI_API_KEY missing)",
            "map_provider": "OpenStreetMap tiles (browser)",
            "geocoding_provider": "OpenStreetMap Nominatim (public demo endpoint)",
            "routing_provider": "OSRM public demo endpoint (not traffic-aware)",
            "traffic_provider": live_traffic_provider_status()}


# ---------------- TRAFFIC ----------------

@app.get("/traffic")
def get_traffic():
    return {"roads": get_all_roads()}


@app.get("/traffic")
def get_traffic():
    return {"roads": get_all_roads()}


@app.get("/traffic/history")
def traffic_history():
    return {"history": get_traffic_history()}


@app.get("/traffic/live")
def live_traffic(latitude: float = Query(..., ge=-90, le=90), longitude: float = Query(..., ge=-180, le=180)):
    """Fetch a provider-backed traffic observation for a specific road point."""
    try:
        return get_live_traffic_flow(latitude, longitude)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except TrafficProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc))



@app.get("/traffic/{road_name}")
def get_single_road(road_name: str):
    road = get_road(road_name)
    if road is None:
        raise HTTPException(status_code=404, detail="Road not found")
    return road


@app.put("/traffic/{road_name}")
def update_traffic(road_name: str, data: TrafficUpdate):
    if get_road(road_name) is None:
        raise HTTPException(status_code=404, detail="Road not found")

    updated = update_road(
        road_name,
        data.vehicle_count,
        data.average_speed,
        data.congestion,
    )
    save_traffic_history(updated)
    return {"message": "Traffic updated successfully", "road": updated}


@app.get("/traffic/history")
def traffic_history():
    return {"history": get_traffic_history()}




def serialize_incident(item):
    out = dict(item)

    out["type"] = out.pop("incident_type", out.get("type", "OTHER"))
    out["status"] = str(out.get("status", "ACTIVE")).upper()

    if "timestamp" in out:
        try:
            out["reported_at"] = int(
                datetime.fromisoformat(out["timestamp"]).timestamp() * 1000
            )
        except Exception:
            out["reported_at"] = 0

    out["ai"] = AI_RESULTS.get(out["id"])

    return out

# ---------------- INCIDENTS ----------------

@app.post("/accident")
def create_accident(request: AccidentRequest):
    result = simulate_accident(request.road, request.severity)
    if result is None:
        raise HTTPException(status_code=404, detail="Road not found")

    add_incident(
        road=request.road,
        incident_type="ACCIDENT",
        severity=request.severity.upper(),
        status="active",
    )

    for road in get_all_roads():
        save_traffic_history(road)

    return result


@app.get("/incidents")
def get_incidents():
    return {"incidents": [serialize_incident(i) for i in get_all_incidents()]}


@app.put("/incidents/{incident_id}")
def update_incident(incident_id: int, data: IncidentStatusUpdate):
    update_incident_status(incident_id, data.status)
    return {"message": "Incident status updated", "id": incident_id, "status": data.status}


# Frontend-compatible aliases
class EmergencyReport(BaseModel):
    type: str
    road: str
    info: str = ""
    vehicles_involved: int = Field(default=1, ge=0)
    lane_blocked: int = Field(default=1, ge=0)
    ambulance_required: bool = False
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_label: str | None = Field(default=None, max_length=250)


@app.post("/emergencies")
def report_emergency(data: EmergencyReport):
    if (data.latitude is None) != (data.longitude is None):
        raise HTTPException(status_code=422, detail="Latitude and longitude must be supplied together")
    road = get_road(data.road)
    if road is None:
        raise HTTPException(status_code=404, detail="Road not found")

    current_roads = {
        r["name"]: r["status"] if r["status"] == "BLOCKED" else r["congestion"]
        for r in get_all_roads()
    }

    incident_data = {
        "incident_type": data.type.lower(),
        "location": data.road,
        "vehicles_involved": data.vehicles_involved,
        "lane_blocked": data.lane_blocked,
        "ambulance_required": data.ambulance_required,
        "roads": current_roads,
    }

    try:
        incident_result = analyze_incident(incident_data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI service error: {exc}")

    severity = str(incident_result.get("severity", "MEDIUM")).upper()

    if data.type.upper() == "ACCIDENT":
        simulate_accident(data.road, severity.lower())

    add_incident(
        road=data.road,
        incident_type=data.type.upper(),
        severity=severity,
        status="active",
    )

    created = serialize_incident(get_all_incidents()[0])
    if data.latitude is not None and data.longitude is not None:
        set_incident_location(created["id"], data.latitude, data.longitude, data.location_label)
        created["latitude"], created["longitude"] = data.latitude, data.longitude
        created["location_label"] = data.location_label
    latest_roads = {
        r["name"]: r["status"] if r["status"] == "BLOCKED" else r["congestion"]
        for r in get_all_roads()
    }
    traffic_result = get_traffic_result(build_traffic_ai_input(latest_roads))
    created["ai"] = {
        "traffic_impact": traffic_result["traffic_impact"],
        "affected_roads": traffic_result["affected_roads"],
        "recommended_route": traffic_result["recommended_route"],
        "reason": f'{incident_result.get("reason", "")} {traffic_result["reason"]}'.strip(),
    }

    AI_RESULTS[created["id"]] = created["ai"]

    
    created["incident_result"] = incident_result
    return created


@app.patch("/emergencies/{incident_id}/status")
def update_emergency_status(incident_id: int, data: IncidentStatusUpdate):
    update_incident_status(incident_id, data.status.lower())
    incidents = get_all_incidents()
    incident = next((i for i in incidents if i["id"] == incident_id), None)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return serialize_incident(incident)


# ---------------- DASHBOARD / AI ----------------

@app.get("/dashboard")
def dashboard():
    roads = get_all_roads()
    incidents = get_all_incidents()
    return {
        "total_roads": len(roads),
        "high_congestion_roads": sum(1 for r in roads if r["congestion"] == "HIGH"),
        "active_incidents": sum(1 for i in incidents if i["status"] == "active"),
        "roads": roads,
    }


@app.get("/ai/input")
def get_ai_input():
    incidents = get_all_incidents()
    return {
        "timestamp": datetime.now().isoformat(),
        "traffic": get_all_roads(),
        "active_incidents": [i for i in incidents if i["status"] == "active"],
    }


class IncidentData(BaseModel):
    incident_type: str
    location: str
    vehicles_involved: int
    lane_blocked: int
    ambulance_required: bool
    roads: dict[str, str] | None = None


def build_traffic_ai_input(roads):
    normalized = {}
    for road, status in roads.items():
        s = str(status).lower()
        normalized[road] = (
            "blocked" if s == "blocked"
            else s if s in {"high", "medium", "low"}
            else "low"
        )
    return normalized


@app.post("/analyze")
def analyze(data: IncidentData):
    incident_data = data.model_dump()

    try:
        incident_result = analyze_incident(incident_data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI service error: {exc}")

    roads = incident_data.get("roads") or {
        r["name"]: ("blocked" if r["status"] == "BLOCKED" else r["congestion"]).lower()
        for r in get_all_roads()
    }
    traffic_result = get_traffic_result(build_traffic_ai_input(roads))

    return {
        "status": "success",
        "incident_result": incident_result,
        "traffic_result": traffic_result,
    }


@app.post("/explain")
def explain(data: IncidentData, question: str):
    incident_data = data.model_dump()
    try:
        incident_result = analyze_incident(incident_data)
        explanation = explain_decision(incident_data, incident_result, question)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI service error: {exc}")
    return {"status": "success", "explanation": explanation}


# ---------------- GEOGRAPHIC SERVICES ----------------

class GeocodeRequest(BaseModel):
    query: str = Field(min_length=3, max_length=200)

class RouteRequest(BaseModel):
    origin_lat: float = Field(ge=-90, le=90)
    origin_lon: float = Field(ge=-180, le=180)
    destination_lat: float = Field(ge=-90, le=90)
    destination_lon: float = Field(ge=-180, le=180)

@app.get("/geo/incidents")
def geographic_incidents():
    locations = {x["incident_id"]: x for x in get_incident_locations()}
    records = []
    for item in get_all_incidents():
        row = serialize_incident(item)
        loc = locations.get(row["id"])
        if loc:
            row["latitude"] = loc["latitude"]
            row["longitude"] = loc["longitude"]
            row["location_label"] = loc.get("location_label")
            records.append(row)
    return {"incidents": records, "source": "Stored incident GPS coordinates"}

@app.post("/geo/geocode")
def geographic_search(data: GeocodeRequest):
    try:
        return {"results": geocode(data.query), "provider": "OpenStreetMap Nominatim"}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except GeoProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

@app.post("/routes/calculate")
def calculate_route(data: RouteRequest):
    try:
        routes = calculate_geo_route(data.origin_lat, data.origin_lon,
            data.destination_lat, data.destination_lon)
        return {"routes": routes, "provider": "OSRM demo routing service",
                "notice": "Road-network route only; not traffic-aware and not validated for emergency vehicle access."}
    except GeoProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

@app.get("/analytics/summary")
def analytics_summary():
    incidents = get_all_incidents()
    roads = get_all_roads()
    return {
        "source": "Persisted SQLite records",
        "total_incidents": len(incidents),
        "resolved_incidents": sum(
    1 for x in incidents
    if str(x.get("status", "")).strip().lower() in ("resolved", "closed")
),
        "active_incidents": sum(1 for x in incidents if str(x["status"]).lower() not in {"resolved", "closed"}),
        "severity_distribution": {s: sum(1 for x in incidents if str(x["severity"]).upper()==s)
                                  for s in ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"]},
        "incident_type_distribution": {t: sum(1 for x in incidents if str(x["incident_type"]).upper()==t)
                                       for t in sorted({str(x["incident_type"]).upper() for x in incidents})},
        "roads": len(roads),
        "traffic_provider_status": "NOT_CONFIGURED — stored/simulated traffic only"
    }

# ---------------- LIVE TRAFFIC ----------------

@app.websocket("/ws/traffic")
async def traffic_websocket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({
                "type": "traffic_update",
                "roads": get_all_roads(),
            })
            await asyncio.sleep(3)
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass
