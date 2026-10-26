import unittest

import pytest


def test_call():
    assert True


def test_mark_keyword():
    assert True


def test_mark_positional():
    assert True


def test_xfail():
    assert False is False


class TestCaseReasons(unittest.TestCase):
    def test_skiptest(self):
        self.assertTrue(True)

    def test_decorator(self):
        self.assertTrue(True)
