def traffic_impact(roads):
    blocked_count = 0
    high_count = 0

    for status in roads.values():
        if status == "blocked":
            blocked_count += 1
        elif status == "high":
            high_count += 1

    if blocked_count >= 1:
        return "HIGH"
    elif high_count >= 1:
        return "MEDIUM"
    else:
        return "LOW"


def recommend_route(roads):
    priority = {
        "low": 1,
        "medium": 2,
        "high": 3
    }

    available = []

    for road, status in roads.items():
        if status != "blocked":
            available.append((road, status))

    if not available:
        return None

    available.sort(key=lambda x: priority[x[1]])

    return available[0][0]


def get_traffic_result(roads):

    impact = traffic_impact(roads)

    recommended_route = recommend_route(roads)

    affected_roads = []

    for road, status in roads.items():
        if status == "high":
            affected_roads.append(road)

    if recommended_route:
        reason = (
            f"{recommended_route} has low traffic "
            f"and is not blocked."
        )
    else:
        reason = "No available emergency route."

    return {
        "traffic_impact": impact,
        "affected_roads": affected_roads,
        "recommended_route": recommended_route,
        "reason": reason
    }

if __name__ == "__main__":
    roads = {
        "Road A": "blocked",
        "Road B": "high",
        "Road C": "medium",
        "Road D": "low",
        "Road E": "high"
    }

    result = get_traffic_result(roads)

    print("Traffic AI Result:")
    print(result)