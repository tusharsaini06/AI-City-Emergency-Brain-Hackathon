from dotenv import load_dotenv
import os
import json
from google import genai

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


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

    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
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

    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
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