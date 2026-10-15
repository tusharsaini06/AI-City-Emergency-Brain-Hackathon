from database import (
    get_all_roads,
    get_road,
    add_road,
    update_road
)


# ---------------------------------
# INITIAL CITY TRAFFIC
# ---------------------------------

def create_initial_traffic():

    # Don't create duplicate roads
    if get_all_roads():
        return

    add_road(
        "Road A",
        85,
        18,
        "HIGH"
    )

    add_road(
        "Road B",
        30,
        42,
        "LOW"
    )

    add_road(
        "Road C",
        50,
        30,
        "MEDIUM"
    )


# ---------------------------------
# CONGESTION CALCULATION
# ---------------------------------

def calculate_congestion(
    vehicle_count,
    average_speed
):

    if vehicle_count >= 80 or average_speed < 20:
        return "HIGH"

    elif vehicle_count >= 50 or average_speed < 35:
        return "MEDIUM"

    else:
        return "LOW"


# ---------------------------------
# ACCIDENT SIMULATION
# ---------------------------------

def simulate_accident(
    road_name,
    severity
):

    selected_road = get_road(road_name)

    if selected_road is None:
        return None

    # Save the number of vehicles
    # before blocking the road
    vehicles_to_shift = selected_road["vehicle_count"]

    # Block the road
    update_road(
        road_name,
        0,
        0,
        "BLOCKED",
        "BLOCKED"
    )

    # Find other open roads
    all_roads = get_all_roads()

    other_roads = [
        road
        for road in all_roads
        if road["name"] != road_name
        and road["status"] == "OPEN"
    ]

    if len(other_roads) == 0:

        return {
            "message": "Accident simulated",
            "blocked_road": road_name,
            "affected_roads": []
        }

    # Distribute vehicles between
    # available roads
    vehicles_per_road = (
        vehicles_to_shift // len(other_roads)
    )

    affected_roads = []

    for road in other_roads:

        new_vehicle_count = (
            road["vehicle_count"]
            + vehicles_per_road
        )

        # Traffic increases,
        # speed decreases
        new_speed = max(
            5,
            road["average_speed"]
            - vehicles_per_road * 0.15
        )

        new_congestion = calculate_congestion(
            new_vehicle_count,
            new_speed
        )

        updated_road = update_road(
            road["name"],
            new_vehicle_count,
            round(new_speed, 2),
            new_congestion
        )

        affected_roads.append(updated_road)

    return {

        "message": "Accident simulated successfully",

        "blocked_road": road_name,

        "severity": severity,

        "vehicles_shifted": vehicles_to_shift,

        "affected_roads": affected_roads
    }