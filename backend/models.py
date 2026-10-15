from pydantic import BaseModel, Field


class TrafficUpdate(BaseModel):
    vehicle_count: int = Field(ge=0)
    average_speed: float = Field(ge=0)
    congestion: str


class AccidentRequest(BaseModel):
    road: str
    severity: str = "high"


class IncidentStatusUpdate(BaseModel):
    status: str