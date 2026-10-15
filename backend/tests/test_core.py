import unittest
from traffic_module import get_traffic_result
from main import RouteRequest, GeocodeRequest

class TrafficModuleTests(unittest.TestCase):
    def test_blocked_road_not_recommended(self):
        result = get_traffic_result({"A": "blocked", "B": "low", "C": "high"})
        self.assertEqual(result["recommended_route"], "B")
        self.assertNotIn("A", result["affected_roads"])

    def test_all_roads_blocked_has_no_route(self):
        result = get_traffic_result({"A": "blocked", "B": "blocked"})
        self.assertIsNone(result["recommended_route"])

class RequestValidationTests(unittest.TestCase):
    def test_route_coordinates_accept_valid_values(self):
        request = RouteRequest(origin_lat=28.98, origin_lon=77.70,
                               destination_lat=28.99, destination_lon=77.71)
        self.assertEqual(request.origin_lat, 28.98)

    def test_route_coordinates_reject_out_of_range(self):
        with self.assertRaises(Exception):
            RouteRequest(origin_lat=120, origin_lon=77.7,
                         destination_lat=28.99, destination_lon=77.71)

    def test_geocode_query_minimum_length(self):
        with self.assertRaises(Exception):
            GeocodeRequest(query="a")

if __name__ == "__main__":
    unittest.main()
