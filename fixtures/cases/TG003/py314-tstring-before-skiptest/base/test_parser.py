import unittest


class TestParser(unittest.TestCase):
    def test_parses(self):
        self.assertEqual(int("1"), 1)
