from fastapi import FastAPI
from pydantic import BaseModel

from ai_service import analyze_incident, explain_decision
from traffic_module import get_traffic_result


app = FastAPI(title="AI City Brain")


@app.get("/")
def home():
    return {
        "message": "AI City Brain Backend is running!"
    }


@app.get("/health")
def health():
    return {
        "status": "OK"
    }


class IncidentData(BaseModel):
    incident_type: str
    location: str
    vehicles_involved: int
    lane_blocked: int
    ambulance_required: bool
    roads: dict


@app.post("/analyze")
def analyze(data: IncidentData):

    incident_data = data.model_dump()

    # Incident + Severity AI
    incident_result = analyze_incident(incident_data)

    # Traffic AI
    traffic_result = get_traffic_result(
        incident_data["roads"]
    )

    # Combined result
    return {
        "status": "success",
        "incident_result": incident_result,
        "traffic_result": traffic_result
    }


@app.post("/explain")
def explain(data: IncidentData, question: str):

    incident_data = data.model_dump()

    incident_result = analyze_incident(incident_data)

    explanation = explain_decision(
        incident_data,
        incident_result,
        question
    )

    return {
        "status": "success",
        "explanation": explanation
    }