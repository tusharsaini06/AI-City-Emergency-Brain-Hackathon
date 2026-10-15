from dotenv import load_dotenv
import os
import json
try:
    from google import genai
except ImportError:  # Allows demo mode to start before optional AI dependencies are installed.
    genai = None

from pathlib import Path
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

def _client():
    key = os.getenv("GEMINI_API_KEY")
    if not key or genai is None:
        return None
    return genai.Client(api_key=key)


def _rules_fallback(incident_data):
    # Explicit local demonstration fallback; never represented as a live model response.
    kind = str(incident_data.get("incident_type", "other")).lower()
    lanes = int(incident_data.get("lane_blocked", 0) or 0)
    vehicles = int(incident_data.get("vehicles_involved", 0) or 0)
    ambulance = bool(incident_data.get("ambulance_required", False))
    if ambulance or lanes >= 2 or kind in {"fire", "building collapse"}:
        severity = "HIGH"
    elif lanes >= 1 or vehicles >= 2 or kind in {"medical emergency", "flooding", "electrical hazard"}:
        severity = "MEDIUM"
    else:
        severity = "LOW"
    return {"incident_type": kind, "severity": severity,
            "emergency_required": severity == "HIGH" or ambulance,
            "reason": "DEMO RULES (no Gemini API key configured): " +
                      f"{kind} report; lane blockage={lanes}, vehicles={vehicles}, ambulance required={ambulance}."}


def analyze_incident(incident_data):

    prompt = """
You are the Incident and Severity AI module of an emergency traffic management system.

Analyze ONLY the incident information below.

INCIDENT DATA:
""" + json.dumps({
        "incident_type": incident_data["incident_type"],
        "location": incident_data["location"],
        "vehicles_involved": incident_data["vehicles_involved"],
        "lane_blocked": incident_data["lane_blocked"],
        "ambulance_required": incident_data["ambulance_required"]
    }, indent=2) + """

Return ONLY valid JSON with exactly these fields:

{
  "incident_type": "accident",
  "severity": "HIGH",
  "emergency_required": true,
  "reason": "The accident blocks one lane and requires an ambulance."
}

Rules:
- severity must be LOW, MEDIUM, or HIGH.
- emergency_required must be true or false.
- incident_type must describe the incident provided.
- Keep reason short and clear.
- Explain severity using only the provided incident information.
- Do not analyze traffic.
- Do not recommend roads.
- Do not add traffic_impact.
- Do not add affected_roads.
- Do not add recommended_route.
- Do not add expected_congestion.
- Do not add extra fields.
- Return JSON only.
- Do not use markdown or ``` around the JSON.
"""

    client = _client()
    if client is None:
        return _rules_fallback(incident_data)
    response = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=prompt
    )

    raw_result = response.text.strip()

    # Remove markdown fences if the model accidentally adds them
    if raw_result.startswith("```"):
        raw_result = raw_result.replace("```json", "")
        raw_result = raw_result.replace("```", "")
        raw_result = raw_result.strip()

    # Convert JSON string into a real Python dictionary
    result = json.loads(raw_result)

    return result


def explain_decision(incident_data, ai_result, question):

    prompt = """
You are an AI operator assistant for a city emergency traffic system.

Incident:
""" + json.dumps(incident_data, indent=2) + """

AI decision:
""" + json.dumps(ai_result, indent=2) + """

Operator question:
""" + question + """

Answer the operator clearly in 2-3 short sentences.

Explain only using the information provided above.
Do not invent information.
"""

    client = _client()
    if client is None:
        return "DEMO RULES: Gemini API is not configured. The incident assessment was generated from the supplied fields only: " + str(ai_result.get("reason", "No assessment available"))
    response = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=prompt
    )

    return response.text.strip()


if __name__ == "__main__":

    incident = {
        "incident_type": "accident",
        "location": "Main Road",
        "vehicles_involved": 2,
        "lane_blocked": 1,
        "ambulance_required": True,

        "roads": {
            "Main Road": "BLOCKED",
            "Road B": "HIGH",
            "Road C": "LOW",
            "Road D": "MEDIUM"
        }
    }

    result = analyze_incident(incident)

    print("INCIDENT / SEVERITY RESULT:")
    print(json.dumps(result, indent=2))

    question = "Why is the severity HIGH?"

    explanation = explain_decision(
        incident,
        result,
        question
    )

    print("\nAI OPERATOR ASSISTANT:")
    print(explanation)