# AI City Emergency Brain — upgraded prototype

An upgraded version of the supplied project. The existing vanilla HTML/CSS/JavaScript dashboard, FastAPI backend, SQLite persistence, traffic module, incident workflow, and `/ws/traffic` WebSocket contract are retained.

## What is included

- Real interactive Leaflet map using OpenStreetMap tiles, zoom/pan, incident markers, browser location (only on request), place search, and road-network route calculation.
- Geocoding adapter: OpenStreetMap Nominatim public endpoint.
- Optional TomTom live traffic-flow adapter at `GET /traffic/live?latitude=28.9845&longitude=77.7064`; reports one road-segment observation only and never silently substitutes simulated data.
- Routing adapter: OSRM public demo endpoint; returns road geometry, distance and estimated duration. It is **not traffic-aware** and is not validated for emergency-vehicle access.
- Incident coordinates can be accepted by `POST /emergencies` and retrieved through `GET /geo/incidents`. Existing database tables are preserved; coordinates are stored in a separate `incident_locations` table.
- Persistent analytics summary from SQLite, AI-provider health status, and explicit AI fallback behavior.
- Existing command dashboard, incident reporting, traffic data, AI analysis endpoints, and traffic WebSocket remain.

## Important data integrity notes

- Existing traffic data and the traffic module are local database/simulation data. No live traffic provider is configured, and the UI/API do not claim otherwise.
- Existing sample road names and map marker positions near Meerut are demonstration-only. They are not verified street geometry or incident GPS coordinates. Real incident markers are shown only when coordinates are stored.
- Without `GEMINI_API_KEY`, incident analysis uses a small local rules fallback with `DEMO RULES` in its explanation. It is not a live AI model.
- No real emergency services are contacted or dispatched. This is a prototype, not a replacement for official emergency services.
- Public Nominatim and OSRM services have usage limits and availability constraints. For production, use an appropriately licensed provider and configure rate limits, attribution, monitoring, and credentials as required.

## Prerequisites

- Python 3.10+ recommended
- Internet access for OpenStreetMap tiles, geocoding, and route calculation
- Optional Gemini API key for model-based incident analysis

## Run on Windows PowerShell

```powershell
cd final_project\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Optional: edit .env and set GEMINI_API_KEY
uvicorn main:app --reload
```

Backend: http://127.0.0.1:8000  
API docs: http://127.0.0.1:8000/docs  
Health/provider status: http://127.0.0.1:8000/health

In a second PowerShell terminal, serve the frontend (recommended over opening the file directly):

```powershell
cd final_project\frontend
python -m http.server 5500
```

Open http://127.0.0.1:5500. The frontend API base is `http://127.0.0.1:8000` in `frontend/js/app.js`.

## Configure external APIs

The `.env` file must be located at `final_project/backend/.env`. Never put provider keys in frontend JavaScript or commit the `.env` file.

- **Gemini AI:** create an API key in Google AI Studio, then set `GEMINI_API_KEY=...` and `GEMINI_MODEL=gemini-2.5-flash`. The installed `google-genai` package is used by the backend. Restart Uvicorn after editing `.env`. Without the key, analysis stays in clearly labelled demo-rules mode.
- **TomTom live traffic:** obtain a TomTom developer key with access to the Traffic Flow API, then set `TOMTOM_API_KEY=...`. Restart Uvicorn. Test it at `http://127.0.0.1:8000/traffic/live?latitude=28.9845&longitude=77.7064`. This returns traffic flow for a point/road segment; it is not a city-wide feed and is not automatically connected to emergency route optimization.
- **Map/geocoding/routing:** OpenStreetMap tiles, Nominatim and OSRM public demo endpoints do not use your Gemini key. They are public services with usage limits; OSRM routing is not traffic-aware.

## Useful API endpoints

- `GET /health` — service/provider configuration status
- `GET /traffic`, `GET /traffic/history` — stored traffic and history
- `GET /traffic/live?latitude=28.9845&longitude=77.7064` — optional TomTom live point traffic observation (requires `TOMTOM_API_KEY`)
- `GET /incidents`, `POST /emergencies` — incidents
- `PATCH /emergencies/{id}/status` and existing incident update routes — status workflow
- `GET /geo/incidents` — incidents with stored GPS coordinates
- `POST /geo/geocode` with `{"query":"Meerut railway station"}` — place search
- `POST /routes/calculate` with origin/destination latitude and longitude — OSRM route calculation
- `GET /analytics/summary` — analytics from persisted records
- `POST /analyze`, `POST /explain` — incident analysis and explanation
- `WS /ws/traffic` — existing traffic update stream

## Testing

From `final_project/backend`:

```powershell
python -m unittest discover -s tests -v
```

Also run `python -m compileall .` for Python syntax checks. The frontend JavaScript can be checked with `node --check ..\frontend\js\app.js` if Node.js is installed.

## Known limitations

- Live traffic point observations are available only when a valid TomTom key is configured; a city-wide live traffic feed and traffic-aware routing, weather, responder management, authentication/role permissions, image analysis, notification persistence, and full audit history are not implemented.
- The existing UI's non-map dashboard still contains its pre-existing demo-oriented assumptions. Do not treat demo records as operational data.
- Public map/geocoding/routing services can fail due to network limits; the application displays failures rather than inventing live results.
