import unittest

import pytest


def test_call():
    pytest.skip(t"not on {'this'} platform")
    assert True


@pytest.mark.skip(reason=t"flaky")
def test_mark_keyword():
    assert True


@pytest.mark.skip(t"flaky")
def test_mark_positional():
    assert True


@pytest.mark.xfail(reason=t"known bug")
def test_xfail():
    assert False is False


class TestCaseReasons(unittest.TestCase):
    def test_skiptest(self):
        self.skipTest(t"later")
        self.assertTrue(True)

    @unittest.skip(t"later")
    def test_decorator(self):
        self.assertTrue(True)
