"""External geographic adapters. Public demo services are rate-limited; configure a commercial provider for production."""
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import json

class GeoProviderError(RuntimeError):
    pass

def geocode(query: str):
    if not query or len(query.strip()) < 3:
        raise ValueError("Search query must contain at least 3 characters")
    params = urlencode({"q": query.strip(), "format": "jsonv2", "limit": 5})
    req = Request("https://nominatim.openstreetmap.org/search?" + params,
                  headers={"User-Agent": "AICityEmergencyBrain/1.0 (prototype; configure before production)"})
    try:
        with urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise GeoProviderError("Geocoding provider is unavailable") from exc
    return [{"display_name": x.get("display_name"), "lat": float(x["lat"]), "lon": float(x["lon"]),
             "source": "OpenStreetMap Nominatim"} for x in data]

def route(origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float):
    # OSRM public demo endpoint: route geometry and distance are calculated from road-network data.
    url = "https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson&steps=false&alternatives=true".format(
        origin_lon, origin_lat, dest_lon, dest_lat)
    req = Request(url, headers={"User-Agent": "AICityEmergencyBrain/1.0"})
    try:
        with urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise GeoProviderError("Routing provider is unavailable") from exc
    if data.get("code") != "Ok" or not data.get("routes"):
        raise GeoProviderError("No route was returned for these coordinates")
    return [{"distance_m": round(r["distance"]), "duration_s": round(r["duration"]),
             "geometry": r["geometry"], "source": "OSRM demo routing service",
             "traffic_aware": False} for r in data["routes"]]
