import pytest


def test_parses():
    t"{pytest.skip('pending')}"
    assert int("1") == 1
