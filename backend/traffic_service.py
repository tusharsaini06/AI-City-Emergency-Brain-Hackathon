"""Optional TomTom live traffic adapter. Never silently substitutes demo data for live results."""
import json
import os
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class TrafficProviderError(RuntimeError):
    pass


def provider_status():
    if os.getenv("TOMTOM_API_KEY", "").strip():
        return "TomTom configured"
    return "NOT CONFIGURED — database/simulation only"


def get_flow(latitude: float, longitude: float):
    key = os.getenv("TOMTOM_API_KEY", "").strip()
    if not key:
        raise TrafficProviderError("Live traffic is not configured. Add TOMTOM_API_KEY to backend/.env and restart the backend.")
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("Invalid latitude or longitude")

    params = urlencode({"key": key, "unit": "KMPH", "thickness": 1, "openLr": "false"})
    url = (f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point="
           f"{latitude},{longitude}&{params}")
    request = Request(url, headers={"User-Agent": "AICityEmergencyBrain/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise TrafficProviderError("TomTom rejected the API key or the key lacks access to this endpoint.") from exc
        if exc.code == 429:
            raise TrafficProviderError("TomTom traffic API rate limit reached. Try again later.") from exc
        raise TrafficProviderError(f"TomTom traffic API returned HTTP {exc.code}.") from exc
    
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise TrafficProviderError(
            f"TomTom request failed: {type(exc).__name__}: {exc}"
        ) from exc


    flow = payload.get("flowSegmentData")
    if not isinstance(flow, dict):
        raise TrafficProviderError("TomTom response did not contain flow-segment data.")

    current = flow.get("currentSpeed")
    free = flow.get("freeFlowSpeed")
    ratio = (current / free) if isinstance(current, (int, float)) and isinstance(free, (int, float)) and free > 0 else None
    if ratio is None:
        congestion = "UNKNOWN"
    elif ratio < 0.25:
        congestion = "SEVERE"
    elif ratio < 0.5:
        congestion = "HIGH"
    elif ratio < 0.75:
        congestion = "MODERATE"
    else:
        congestion = "LOW"

    return {
        "provider": "TomTom Traffic Flow API",
        "source_type": "provider_observation",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "location": {"latitude": latitude, "longitude": longitude},
        "current_speed_kmph": current,
        "free_flow_speed_kmph": free,
        "current_travel_time_seconds": flow.get("currentTravelTime"),
        "free_flow_travel_time_seconds": flow.get("freeFlowTravelTime"),
        "confidence": flow.get("confidence"),
        "road_closure": flow.get("roadClosure"),
        "congestion": congestion,
        "data_source": "TomTom live provider response; point/road segment observation, not city-wide traffic",
    }
