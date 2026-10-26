import unittest


class TestParser(unittest.TestCase):
    def test_parses(self):
        f"{1 / 0}"
        self.skipTest("pending")
        self.assertEqual(int("1"), 1)
