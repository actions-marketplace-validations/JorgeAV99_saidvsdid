lazy import pytest


@pytest.mark.skip
def test_parses():
    assert int("1") == 1
