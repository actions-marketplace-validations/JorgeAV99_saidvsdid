import pytest
from string.templatelib import Interpolation, Template


def render(template: Template) -> str:
    out = []
    for part in template:
        if isinstance(part, Interpolation):
            out.append(format(part.value, part.format_spec))
        else:
            out.append(part)
    return "".join(out)


@pytest.mark.skip
def test_renders():
    name = "world"
    assert render(t"hello {name}") == "hello world"


def test_format_spec():
    value = 3.14159
    assert render(t"{value:.2f}") == "3.14"


def test_interpolations():
    a, b = 1, 2
    template = t"{a} + {b} = {a + b!r}"
    assert [i.expression for i in template.interpolations] == ["a", "b", "a + b"]


def test_except_without_parentheses():
    try:
        int("x")
    except ValueError, TypeError:
        caught = True
    assert caught


def test_deferred_annotation():
    def helper(mark: pytest.MarkDecorator) -> pytest.MarkDecorator:
        return mark

    assert helper.__annotations__["mark"] is pytest.MarkDecorator
