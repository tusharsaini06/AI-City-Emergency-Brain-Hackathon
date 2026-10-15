from traffic_module import get_traffic_result


# Traffic AI Testing

test_cases = [
    {
        "name": "Normal Traffic",
        "roads": {
            "Road A": "low",
            "Road B": "medium",
            "Road C": "low",
            "Road D": "medium"
        }
    },

    {
        "name": "Blocked Road",
        "roads": {
            "Road A": "blocked",
            "Road B": "high",
            "Road C": "low",
            "Road D": "medium"
        }
    },

    {
        "name": "Multiple Blocked Roads",
        "roads": {
            "Road A": "blocked",
            "Road B": "blocked",
            "Road C": "high",
            "Road D": "low"
        }
    },

    {
        "name": "All Roads Blocked",
        "roads": {
            "Road A": "blocked",
            "Road B": "blocked",
            "Road C": "blocked"
        }
    }
]


# Run all test cases

for test in test_cases:

    result = get_traffic_result(test["roads"])

    print("\n-------------------------")
    print("Test:", test["name"])
    print("Traffic Impact:", result["traffic_impact"])
    print("Affected Roads:", result["affected_roads"])
    print("Recommended Route:", result["recommended_route"])
    print("Reason:", result["reason"])