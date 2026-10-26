"""Which declaration each name of a Python test file refers to, read by Python itself.

saidvsdid (src/parse/py-scopes.ts) runs this script once per call of at most 1 MB of source
(`python -I -X utf8`), stdin, stdout and stderr being files: a JSON object on stdin, {"files": [{"id": ..., "source":
<the file's bytes, base64>}]}, and one on stdout, {"protocol": 6, "python": "3.12.3", "supported":
true, "tested": true, "why": null, "files": {id: result}}, both read and written as bytes. The interpreter's own
`ast` and `symtable` decide, on the file's bytes as Python decodes them (PEP 263: a coding
declaration, a BOM); nothing here re-implements Python's scoping. A file whose encoding is not
UTF-8 (a declaration of another codec, or a BOM the declaration contradicts) is not read: saidvsdid
reads its text as UTF-8, and the two readings would not be the same file.

A name imported from pytest or unittest is certainly the runner's in the whole file (docs/rules.md,
*Attribution*) only when all of these hold; anything else is a reason, which the rules quote in a
WARN ("may ..."):
  1. the AST shows exactly one binding of the name in the file, and it is an `import` of pytest or
     unittest that is a statement of the module itself (not inside an `if`, a `try`, a class, ...);
  2. symtable's classification is trusted as it is, never reinterpreted: in every symbol table
     other than the module's (functions, classes, lambdas, comprehensions, annotation and
     type-parameter scopes), the name is absent, or global (declared or implicit) and nothing else
     (`is_global()`, and no other predicate of the symbol true but `is_declared_global()` and
     `is_referenced()`; a predicate a later Python adds counts as another classification). Free,
     local, a parameter, nonlocal, assigned, imported, annotated, a namespace: not certain;
  3. the name does not start with `__`: Python binds such names on its own (`__class__` in
     methods, `__classdict__` in generic methods, `__type_params__`, a module's `__name__`...) and
     mangles the private ones in a class (`__omit` is `_Class__omit`), today and in versions to come;
     it is not a builtin (a use before the import would be the builtin), and the file has no star
     import;
  4. courtesy, outside the assumption and with no guarantee: the file writes on none of its members
     (`pytest.mark.skip = ...`, `setattr(pytest, ...)`, `del unittest.x`).
When they hold, every occurrence of the name in the file refers to that import.

For TG001 (docs/rules.md, *Verdicts*, F7) the script also reports how many times the file binds each name, whether
it has a star import, what may rebind its names at run time (NAMESPACE_*), and each class's bases read
exactly: none, or one base that is certainly unittest.TestCase.

Exhaustiveness: every node class of the running interpreter's `ast` is classified below (BINDERS,
NONE); a class that is not, in any version (one newer than TESTED included), makes the version unsupported; a node that is
not, in a file, makes the file unreadable (a WARN). Every `Name` stored or deleted must be explained
by a binder whose value is read (or that has none): one that is not makes its name uncertain.
"""

import ast
import base64
import builtins
import codecs
import io
import json
import symtable
import sys
import tokenize

PROTOCOL = 6
# The oldest version read: the oldest CPython python.org supports. There is no newest: a later version runs the
# script as any other, and what keeps it certain is what keeps a tested one certain (self_check, the closed sets of
# symtable predicates below, a WARN for anything that fails). TESTED is what CI runs; the reply says whether the
# interpreter is one of them, and the report records it.
MINIMUM = (3, 11)
TESTED = ((3, 11), (3, 12), (3, 13), (3, 14), (3, 15))
RUNNER_MODULES = ("pytest", "unittest")
TEST_CASES = ("TestCase", "IsolatedAsyncioTestCase")

# The only classification of a name, in a symbol table other than the module's, that leaves it the
# module's binding: global (declared or implicit), referenced or not. Every other predicate symtable
# has, or will have, is another binding (free, local, a parameter, assigned, imported...).
GLOBAL_ONLY = {"is_global", "is_declared_global", "is_referenced"}
# `self` in a method: its parameter (a cell when a nested scope uses it); in a nested scope: a free reference.
SELF_IN_METHOD = {"is_parameter", "is_local", "is_referenced"}
SELF_NESTED = {"is_free", "is_referenced"}
# A name that starts with `__` is never certain: Python binds such names implicitly and mangles them.
DUNDER = "`%s` starts with `__`: Python binds such names on its own (`__class__`, `__classdict__`, `__type_params__`...) and mangles them in a class, so it is never certainly the import"

# What may rebind a test or its class at run time, beyond the AST's bindings (docs/rules.md, *Verdicts*, F7): a call of
# builtins' `setattr`/`delattr` whose first argument is a class of the file, the module or anything not resolved; a
# write through `globals()`/`vars()`; `exec`/`eval`. A method of the same name (`monkeypatch.setattr`) is not builtins'.
NAMESPACE_WRITERS = ("setattr", "delattr")
NAMESPACE_VIEWS = ("globals", "vars")
NAMESPACE_EVALUATORS = ("exec", "eval")
# Methods of a namespace's dict that only read it.
NAMESPACE_READS = ("get", "keys", "items", "values", "copy", "__contains__", "__getitem__")

# Node classes that bind a name, and what gives the name its value (read for aliases).
BINDERS = {
    "Assign": "targets <- value",
    "AnnAssign": "target <- value (an annotation alone also counts as a binding)",
    "AugAssign": "target <- value",
    "NamedExpr": "target <- value",
    "For": "target <- iter",
    "AsyncFor": "target <- iter",
    "comprehension": "target <- iter",
    "withitem": "optional_vars <- context_expr",
    "Delete": "targets, no value",
    "TypeAlias": "name <- value",
    "Import": "alias names, the import itself",
    "ImportFrom": "alias names, the import itself",
    "alias": "read through Import and ImportFrom",
    "FunctionDef": "name <- decorators",
    "AsyncFunctionDef": "name <- decorators",
    "ClassDef": "name <- decorators",
    "arguments": "each arg <- its default",
    "arg": "read through arguments",
    "ExceptHandler": "name <- type",
    "MatchAs": "name <- the match subject",
    "MatchStar": "name <- the match subject",
    "MatchMapping": "rest <- the match subject",
    "TypeVar": "name, no value",
    "ParamSpec": "name, no value",
    "TypeVarTuple": "name, no value",
    "Global": "names, a declaration that they are the module's (no binding: symtable classifies them)",
    "Nonlocal": "names, a declaration",
    "Name": "a binding only with a Store or Del context, explained by one of the binders above",
}

# Node classes that bind no name. Those with an `identifier` field say why (IDENTIFIER_NONE).
IDENTIFIER_NONE = {
    "Attribute": "attr is a member of an object, not a name",
    "keyword": "arg is the name of a keyword argument",
    "MatchClass": "kwd_attrs are attributes of the subject",
}
NONE = set(IDENTIFIER_NONE) | {
    "Module", "Interactive", "Expression", "FunctionType", "Suite",
    "Return", "Raise", "Try", "TryStar", "Assert", "Expr", "Pass", "Break", "Continue", "If", "While", "With", "AsyncWith", "Match",
    "BoolOp", "BinOp", "UnaryOp", "Lambda", "IfExp", "Dict", "Set", "ListComp", "SetComp", "DictComp", "GeneratorExp", "Await",
    "Yield", "YieldFrom", "Compare", "Call", "FormattedValue", "JoinedStr", "Constant", "Subscript", "Starred", "List", "Tuple", "Slice",
    "Num", "Str", "Bytes", "NameConstant", "Ellipsis", "Index", "ExtSlice",
    "Load", "Store", "Del", "AugLoad", "AugStore", "Param",
    "And", "Or", "Add", "Sub", "Mult", "MatMult", "Div", "Mod", "Pow", "LShift", "RShift", "BitOr", "BitXor", "BitAnd", "FloorDiv",
    "Invert", "Not", "UAdd", "USub", "Eq", "NotEq", "Lt", "LtE", "Gt", "GtE", "Is", "IsNot", "In", "NotIn",
    "match_case", "MatchValue", "MatchSingleton", "MatchSequence", "MatchOr", "TypeIgnore", "TemplateStr", "Interpolation",
}
ABSTRACT = {"AST", "mod", "stmt", "expr", "expr_context", "boolop", "operator", "unaryop", "cmpop", "excepthandler", "pattern", "type_ignore", "type_param", "slice"}
# A field that gives names a value: its class must be a binder.
TARGET_FIELDS = ("target", "targets", "optional_vars")


def node_classes():
    out, todo = {}, [ast.AST]
    while todo:
        for sub in todo.pop().__subclasses__():
            if sub.__module__ == "ast" and sub.__name__ not in out:
                out[sub.__name__] = sub
                todo.append(sub)
    return out


def signature_fields(cls):
    """(type, name) of each field, from the ASDL signature the class's docstring carries."""
    doc = (cls.__doc__ or "").split("\n")[0]
    if "(" not in doc or not doc.endswith(")"):
        return []
    inner = doc[doc.index("(") + 1:-1]
    return [tuple(f.strip().rsplit(" ", 1)) for f in inner.split(",") if " " in f.strip()]


def self_check():
    """Why this interpreter's `ast` is not fully classified, or None."""
    for name, cls in sorted(node_classes().items()):
        if name in ABSTRACT:
            continue
        if name not in BINDERS and name not in NONE:
            return "ast node %s is not classified" % name
        fields = signature_fields(cls)
        if any(t.rstrip("?*") == "identifier" for t, _ in fields) and name not in BINDERS and name not in IDENTIFIER_NONE:
            return "ast node %s has an identifier field and is not classified as a binder" % name
        if any(f in TARGET_FIELDS for _, f in fields) and name not in BINDERS:
            return "ast node %s has a target field and is not classified as a binder" % name
    return None


def pos(node):
    return [node.lineno, node.col_offset, node.end_lineno, node.end_col_offset]


def dotted(node):
    """`a.b.c` -> ['a', 'b', 'c']; None for anything but a name or an attribute chain on a name."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return parts[::-1]


def mangle(name, cls):
    """Python's private name mangling: `__x` used in the body of class `C` is `_C__x`."""
    if cls is None or not name.startswith("__") or name.endswith("__") or "." in name:
        return name
    stripped = cls.lstrip("_")
    return "_" + stripped + name if stripped else name


def root_name(node):
    """The name at the root of `a.b[c].d`, or None."""
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def classification(sym):
    """The predicates of a symtable symbol that are true (`is_global`, `is_free`...), as symtable says."""
    return sorted(p for p in dir(sym) if p.startswith("is_") and callable(getattr(sym, p)) and getattr(sym, p)())


def table_binds(sym):
    return (sym.is_assigned() or sym.is_imported() or sym.is_parameter() or sym.is_declared_global() or sym.is_nonlocal()
            or sym.is_annotated() or sym.is_local() or sym.is_namespace())


class File:
    def __init__(self, source):
        self.tree = ast.parse(source, "<test>", "exec")
        self.table = symtable.symtable(source, "<test>", "exec")
        self.parent = {}
        for node in ast.walk(self.tree):
            name = type(node).__name__
            if name not in BINDERS and name not in NONE:
                raise LookupError("ast node %s (line %s) is not classified" % (name, getattr(node, "lineno", "?")))
            for child in ast.iter_child_nodes(node):
                self.parent[child] = node
        self.sites = {}  # name -> [(kind, line, node)]
        self.explained = set()  # Name nodes explained by a binder
        self.values = []  # (form, line, [names], value node, exact)
        self.unknown = {}  # name -> line: a Name stored by no binder this script reads
        self.runner_imports = []  # (local, path, line, top)
        self.star = None
        self.writes_on = {}  # name -> line: a write on a member of the name (courtesy)
        self.written_attrs = {}  # attribute -> line
        self.tables = []
        self._tables(self.table)
        # Indexes built once, so that a file's cost grows with its size, not with its size squared: the
        # function tables by (name, line), and each class body's statements (identity, as `in` compares them).
        self.function_tables = {}
        for t in self.tables:
            if str(getattr(t.get_type(), "value", t.get_type())).lower() == "function":
                self.function_tables.setdefault((t.get_name(), t.get_lineno()), []).append(t)
        self.class_bodies = {}
        self.other_tables = {}
        self._bindings()

    def _tables(self, table):
        self.tables.append(table)
        for child in table.get_children():
            self._tables(child)

    def class_of(self, node):
        """The class whose body holds `node` (its methods included): the context Python mangles names in."""
        child, n = node, self.parent.get(node)
        while n is not None:
            if isinstance(n, ast.ClassDef):
                body = self.class_bodies.get(n)
                if body is None:
                    body = self.class_bodies[n] = {id(stmt) for stmt in n.body}
                if id(child) in body:
                    return n.name
            child, n = n, self.parent.get(n)
        return None

    def m(self, name, node):
        """`name` as Python binds or looks it up where `node` stands (mangled in a class body)."""
        return mangle(name, self.class_of(node))

    def site(self, name, kind, node):
        self.sites.setdefault(self.m(name, node), []).append((kind, getattr(node, "lineno", 0), node))

    def target_names(self, target, out):
        if isinstance(target, ast.Name):
            out.append(target)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for e in target.elts:
                self.target_names(e, out)
        elif isinstance(target, ast.Starred):
            self.target_names(target.value, out)
        elif isinstance(target, (ast.Attribute, ast.Subscript)):
            root = root_name(target)
            if root is not None:
                self.writes_on.setdefault(self.m(root, target), target.lineno)
            if isinstance(target, ast.Attribute):
                self.written_attrs.setdefault(target.attr, target.lineno)

    def bind_targets(self, form, stmt, targets, value, exact_if_name=True):
        names = []
        for t in targets:
            found = []
            self.target_names(t, found)
            for n in found:
                self.explained.add(n)
                self.site(n.id, form, n)
                names.append(self.m(n.id, n))
        if value is not None and names:
            exact = exact_if_name and len(targets) == 1 and isinstance(targets[0], ast.Name)
            self.values.append((form, stmt.lineno, names, value, exact))

    def _bindings(self):
        for node in ast.walk(self.tree):
            k = type(node).__name__
            if k == "Assign":
                for t in node.targets:
                    self.bind_targets(k, node, [t], node.value)
            elif k in ("AnnAssign", "NamedExpr", "AugAssign"):
                self.bind_targets(k, node, [node.target], node.value, exact_if_name=(k != "AugAssign"))
            elif k in ("For", "AsyncFor", "comprehension"):
                self.bind_targets(k, node if k != "comprehension" else node.target, [node.target], node.iter, exact_if_name=False)
            elif k == "withitem":
                if node.optional_vars is not None:
                    self.bind_targets(k, node.context_expr, [node.optional_vars], node.context_expr, exact_if_name=False)
            elif k == "Delete":
                self.bind_targets(k, node, node.targets, None)
            elif k == "TypeAlias":
                self.bind_targets(k, node, [node.name], node.value)
            elif k in ("Import", "ImportFrom"):
                self.imports(node)
            elif k in ("FunctionDef", "AsyncFunctionDef", "ClassDef"):
                self.site(node.name, k, node)
                if node.decorator_list:
                    for d in node.decorator_list:
                        self.values.append((k, node.lineno, [self.m(node.name, node)], d, False))
            elif k == "arguments":
                self.arguments(node)
            elif k == "ExceptHandler":
                if node.name is not None:
                    self.site(node.name, k, node)
                    if node.type is not None:
                        self.values.append((k, node.lineno, [self.m(node.name, node)], node.type, False))
            elif k in ("MatchAs", "MatchStar", "MatchMapping"):
                name = node.rest if k == "MatchMapping" else node.name
                if name is not None:
                    self.site(name, k, node)
                    subject = self.match_subject(node)
                    if subject is not None:
                        self.values.append((k, node.lineno, [self.m(name, node)], subject, False))
            elif k in ("TypeVar", "ParamSpec", "TypeVarTuple"):
                self.site(node.name, k, node)
            elif k == "Nonlocal":
                # A declaration that a name is an enclosing function's: that function binds it (a site of its own).
                for name in node.names:
                    self.site(name, k, node)
            # `global x` declares that `x` is the module's, and binds nothing: symtable's classification
            # (is_global, declared) says what it is, and an assignment under it is a site of its own.
            elif k == "Call":
                self.courtesy_call(node)
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)) and node not in self.explained:
                self.unknown.setdefault(self.m(node.id, node), node.lineno)
                self.site(node.id, "unknown", node)

    def imports(self, node):
        top = self.parent.get(node) is self.tree
        for a in node.names:
            if a.name == "*":
                self.star = self.star or node.lineno
                continue
            if isinstance(node, ast.Import):
                local = a.asname or a.name.split(".")[0]
                module = a.name.split(".")
                path = module if a.asname else module[:1]
                runner = path[0] in RUNNER_MODULES and (len(path) == 1)
            else:
                local = a.asname or a.name
                runner = node.level == 0 and node.module in RUNNER_MODULES
                path = [node.module, a.name]
            self.site(local, type(node).__name__, node)
            if runner:
                self.runner_imports.append((self.m(local, node), path, node.lineno, top))

    def arguments(self, node):
        positional = list(getattr(node, "posonlyargs", [])) + list(node.args)
        defaults = [None] * (len(positional) - len(node.defaults)) + list(node.defaults)
        for a, d in list(zip(positional, defaults)) + list(zip(node.kwonlyargs, node.kw_defaults)):
            self.site(a.arg, "parameter", a)
            if d is not None:
                self.values.append(("parameter default", a.lineno, [self.m(a.arg, a)], d, True))
        for a in (node.vararg, node.kwarg):
            if a is not None:
                self.site(a.arg, "parameter", a)

    def match_subject(self, node):
        n = node
        while n is not None and not isinstance(n, ast.Match):
            n = self.parent.get(n)
        return n.subject if n is not None else None

    def courtesy_call(self, call):
        fn = call.func
        if isinstance(fn, ast.Name) and fn.id in ("setattr", "delattr") and call.args:
            root = root_name(call.args[0])
            if root is not None:
                self.writes_on.setdefault(self.m(root, call), call.lineno)
            if len(call.args) > 1 and isinstance(call.args[1], ast.Constant) and isinstance(call.args[1].value, str):
                self.written_attrs.setdefault(call.args[1].value, call.lineno)
        elif isinstance(fn, ast.Attribute) and fn.attr in ("__setattr__", "__delattr__"):
            root = root_name(fn.value)
            if root is not None:
                self.writes_on.setdefault(self.m(root, call), call.lineno)
            if call.args and isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
                self.written_attrs.setdefault(call.args[0].value, call.lineno)

    # --- the rule -------------------------------------------------------------------------------

    def other_table(self, name):
        """The first symbol table other than the module's where symtable classifies `name` as anything
        but global (GLOBAL_ONLY): (description, line, the classification); None when there is none.
        Asked once per name (a file asks it per class base and per runner name: the same answer)."""
        if name not in self.other_tables:
            self.other_tables[name] = self._other_table(name)
        return self.other_tables[name]

    def _other_table(self, name):
        for t in self.tables[1:]:
            try:
                sym = t.lookup(name)
            except KeyError:
                continue
            found = classification(sym)
            if not sym.is_global() or not set(found) <= GLOBAL_ONLY:
                kind = t.get_type()
                kind = getattr(kind, "value", kind)
                return "%s `%s`" % (str(kind).lower(), t.get_name()), t.get_lineno(), ", ".join(found) or "no predicate"
        return None

    def doubt(self, name):
        """Why `name` is not certainly bound once, by a statement of the module, in the whole file; or None."""
        sites = self.sites.get(name, [])
        if self.star is not None:
            return "the module has a star import (line %d), which may bind `%s`" % (self.star, name)
        if name in self.unknown:
            return "`%s` is bound at line %d by a form saidvsdid does not read" % (name, self.unknown[name])
        if len(sites) != 1:
            other = [s for s in sites if not self.is_top_runner_import(name, s)] or sites[1:]
            return "`%s` is bound %d times in the file (also at line %d)" % (name, len(sites), other[0][1])
        kind, line, node = sites[0]
        if not self.is_top_runner_import(name, sites[0]):
            if kind in ("Import", "ImportFrom"):
                return "`%s` is imported at line %d inside a block, not by a statement of the module" % (name, line)
            return "`%s` is bound at line %d, not by an import of pytest or unittest" % (name, line)
        other = self.other_table(name)
        if other is not None:
            return "symtable classifies `%s` in %s (line %d) as %s, not as the module's global" % (name, other[0], other[1], other[2])
        if name.startswith("__"):
            return DUNDER % name
        if name in vars(builtins):
            return "`%s` is also a builtin, which a use before the import would refer to" % name
        if name in self.writes_on:
            return "the file writes to `%s`'s members (line %d): outside the assumption, it may not be the runner's" % (name, self.writes_on[name])
        return None

    def is_top_runner_import(self, name, site):
        kind, line, node = site
        return kind in ("Import", "ImportFrom") and any(local == name and l == line and top for local, _, l, top in self.runner_imports) and self.parent.get(node) is self.tree

    def names(self):
        out = {}
        for local, path, line, _ in self.runner_imports:
            if local in out:
                continue
            out[local] = {"path": path, "line": line, "why": self.doubt(local)}
        return out

    def runner_path(self, name):
        for local, path, _, _ in self.runner_imports:
            if local == name:
                return path
        return None

    def aliases(self):
        out = []
        for form, line, names, value, exact in self.values:
            refs = []
            for node in ast.walk(value):
                parts = dotted(node)
                if parts is None:
                    continue
                up = self.parent.get(node)
                if isinstance(up, ast.Attribute) and up.value is node:
                    continue  # part of a longer chain
                base = self.runner_path(self.m(parts[0], node))
                if base is None:
                    continue
                call = up if isinstance(up, ast.Call) and up.func is node else None
                whole = "value" if node is value else "call" if call is not None and call is value else None
                refs.append({"path": base + parts[1:], "at": pos(node), "call": pos(call) if call is not None else None, "whole": whole if exact else None})
            if refs:
                out.append({"form": form, "line": line, "targets": names, "value": pos(value), "refs": refs})
        return out

    def bound(self):
        out = {}
        for name, sites in self.sites.items():
            out[name] = min(s[1] for s in sites)
        for t in self.tables:
            for sym in t.get_symbols():
                if table_binds(sym) and sym.get_name() not in out:
                    out[sym.get_name()] = t.get_lineno()
        return out

    # --- self.<method> ----------------------------------------------------------------------------

    def function_table(self, node):
        found = self.function_tables.get((node.name, node.lineno), [])
        return found[0] if len(found) == 1 else None

    def descendants(self, table):
        for child in table.get_children():
            yield child
            yield from self.descendants(child)

    def self_doubt(self, fn):
        if fn.decorator_list:
            return "the method `%s` is decorated" % fn.name
        positional = list(getattr(fn.args, "posonlyargs", [])) + list(fn.args.args)
        if not positional:
            return "the method `%s` has no parameter" % fn.name
        param = self.m(positional[0].arg, positional[0])
        table = self.function_table(fn)
        if table is None:
            return "the method `%s` (line %d) has no symbol table of its own" % (fn.name, fn.lineno)
        try:
            sym = table.lookup(param)
        except KeyError:
            return "the method `%s` has no symbol `%s` of its own" % (fn.name, param)
        # symtable's classification, as it is: the method's parameter and nothing else in the method,
        # and only a free reference to it in the scopes nested in the method.
        found = classification(sym)
        if not sym.is_parameter() or not set(found) <= SELF_IN_METHOD:
            return "symtable classifies `%s` in the method `%s` as %s, not only as its parameter" % (param, fn.name, ", ".join(found))
        for d in self.descendants(table):
            try:
                inner = d.lookup(param)
            except KeyError:
                continue
            found = classification(inner)
            if not set(found) <= SELF_NESTED:
                return "symtable classifies `%s` in a scope nested in the method `%s` (line %d) as %s, not as the method's parameter" % (param, fn.name, d.get_lineno(), ", ".join(found))
        return None

    def class_doubt(self, cls, seen=frozenset()):
        """Why `cls` is not certainly a unittest.TestCase by its bases in the file; or None."""
        why, reaches = self.bases_doubt(cls, seen)
        if why is not None:
            return why
        return None if reaches else "class `%s` does not inherit unittest.TestCase in the file" % cls.name

    def bases_doubt(self, cls, seen):
        """(why a base of `cls` is not certain, or None; whether the bases reach unittest.TestCase)."""
        if cls in seen:
            return "class `%s` inherits from itself" % cls.name, False
        seen = seen | {cls}
        if cls.decorator_list:
            return "class `%s` is decorated" % cls.name, False
        if cls.keywords:
            return "class `%s` is created with a keyword (`%s`)" % (cls.name, cls.keywords[0].arg or "**"), False
        reaches = False
        for base in cls.bases:
            parts = dotted(base)
            path = None
            if parts is not None:
                root = self.runner_path(self.m(parts[0], base))
                path = root + parts[1:] if root is not None else None
            if path is not None and len(path) == 2 and path[0] == "unittest" and path[1] in TEST_CASES:
                why = self.doubt(self.m(parts[0], base))
                if why is not None:
                    return why, False
                reaches = True
                continue
            if isinstance(base, ast.Name):
                base_name = self.m(base.id, base)
                # `object`, when the file binds no `object` and has no star import: a mixin's root.
                if base_name == "object" and base_name not in self.sites and self.star is None and self.other_table("object") is None:
                    continue
                defs = [s for s in self.sites.get(base_name, []) if s[0] == "ClassDef"]
                if len(self.sites.get(base_name, [])) == 1 and defs and self.parent.get(defs[0][2]) is self.tree:
                    why = self.unique_doubt(base_name)
                    if why is not None:
                        return why, False
                    why, inner = self.bases_doubt(defs[0][2], seen)
                    if why is not None:
                        return why, False
                    reaches = reaches or inner
                    continue
            return "base `%s` of class `%s` is not unittest.TestCase or a class of the module" % (ast.unparse(base), cls.name), False
        return None, reaches

    def unique_doubt(self, name):
        if self.star is not None:
            return "the module has a star import (line %d), which may bind `%s`" % (self.star, name)
        other = self.other_table(name)
        if other is not None:
            return "symtable classifies `%s` in %s (line %d) as %s, not as the module's global" % (name, other[0], other[1], other[2])
        if name.startswith("__"):
            return DUNDER % name
        if name in vars(builtins):
            return "`%s` is also a builtin, which a use before its definition would refer to" % name
        return None

    def literals(self):
        """Every argument of every call whose value `ast.literal_eval` reads, with its kind and its truth value: what a
        mark's argument is (`run=(False)` and `run=0` are false), decided by Python, never by the argument's text."""
        out = []
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            for arg in list(node.args) + [k.value for k in node.keywords]:
                if isinstance(arg, ast.Starred):
                    continue
                try:
                    value = ast.literal_eval(arg)
                    truthy = bool(value)
                except Exception:  # not a literal: ValueError, TypeError, SyntaxError, RecursionError, MemoryError
                    continue
                if isinstance(value, bool):
                    kind = "bool"
                elif value is None:
                    kind = "none"
                elif isinstance(value, (int, float, complex)):
                    kind = "number"
                elif isinstance(value, str):
                    kind = "str"
                else:
                    kind = "other"
                out.append({"at": [arg.lineno, arg.col_offset], "kind": kind, "truthy": truthy})
        return out

    def binds(self):
        """How many times the file binds each name (every site: any scope, any form), mangled as Python binds it."""
        return {name: len(sites) for name, sites in self.sites.items()}

    def builtin(self, func, names):
        """The builtin function `func` calls, when it is one of `names`: the bare name, bound nowhere in the file, or
        `builtins.<name>`; else None."""
        if isinstance(func, ast.Name) and func.id in names and func.id not in self.sites:
            return func.id
        if isinstance(func, ast.Attribute) and func.attr in names and isinstance(func.value, ast.Name) and func.value.id == "builtins":
            return func.attr
        return None

    def dynamic(self):
        """What may rebind names at run time (NAMESPACE_*), with what it may rebind: {"line", "scope"} — scope a class
        of the file (the names of its body), or None for every name of the module and its classes."""
        out = []
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            name = self.builtin(node.func, NAMESPACE_EVALUATORS + NAMESPACE_WRITERS + NAMESPACE_VIEWS)
            if name is None:
                continue
            if name in NAMESPACE_EVALUATORS:
                out.append({"line": node.lineno, "scope": None})
            elif name in NAMESPACE_WRITERS:
                if not node.args:
                    continue
                target = node.args[0]
                if isinstance(target, ast.Name):
                    kinds = {k for k, _, _ in self.sites.get(self.m(target.id, target), [])}
                    if kinds and kinds <= {"Import", "ImportFrom"}:
                        continue  # another module, imported: not this file's names
                    if kinds == {"ClassDef"}:
                        out.append({"line": node.lineno, "scope": target.id})
                        continue
                out.append({"line": node.lineno, "scope": None})  # the module, or anything not resolved
            else:
                parent = self.parent.get(node)
                if isinstance(parent, ast.Subscript) and parent.value is node and isinstance(parent.ctx, ast.Load):
                    continue  # `globals()["x"]`: a read
                if isinstance(parent, ast.Compare):
                    continue  # `"x" in globals()`
                if isinstance(parent, ast.Attribute) and parent.attr in NAMESPACE_READS and isinstance(self.parent.get(parent), ast.Call):
                    continue  # `globals().get("x")`
                out.append({"line": node.lineno, "scope": None})
        return out

    def classes(self):
        """Every class of the file: its bases as written, exactly — none, or one base that is certainly
        unittest.TestCase (a runner import bound once) — or why not; no keyword (a metaclass) either way."""
        out = []
        for cls in ast.walk(self.tree):
            if not isinstance(cls, ast.ClassDef):
                continue
            bases, why = None, None
            if cls.keywords:
                why = "class `%s` is created with a keyword (`%s`)" % (cls.name, cls.keywords[0].arg or "**")
            elif not cls.bases:
                bases = "none"
            elif len(cls.bases) == 1:
                base = cls.bases[0]
                parts = dotted(base)
                root = self.runner_path(self.m(parts[0], base)) if parts is not None else None
                path = root + parts[1:] if root is not None else None
                if path == ["unittest", "TestCase"]:
                    why = self.doubt(self.m(parts[0], base))
                    bases = "testcase" if why is None else None
                else:
                    why = "the base of class `%s` is `%s`, not unittest.TestCase" % (cls.name, ast.unparse(base))
            else:
                why = "class `%s` has %d bases" % (cls.name, len(cls.bases))
            out.append({"at": [cls.lineno, cls.col_offset], "name": cls.name, "bases": bases, "why": why})
        return out

    def methods(self):
        out = []
        for cls in ast.walk(self.tree):
            if not isinstance(cls, ast.ClassDef):
                continue
            chain = None
            for fn in cls.body:
                if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if chain is None:
                    chain = [self.class_doubt(cls)]
                positional = list(getattr(fn.args, "posonlyargs", [])) + list(fn.args.args)
                out.append({
                    "at": [fn.lineno, fn.col_offset],
                    "name": fn.name,
                    "cls": cls.name,
                    "param": self.m(positional[0].arg, positional[0]) if positional else None,
                    "self": self.self_doubt(fn),
                    "chain": chain[0],
                })
        return out


def encoding_doubt(data):
    """Why Python would not decode `data` as the UTF-8 text saidvsdid reads, or None (PEP 263)."""
    try:
        declared, _ = tokenize.detect_encoding(io.BytesIO(data).readline)
    except SyntaxError as e:
        return "Python %d.%d reads no coherent encoding for it: %s" % (sys.version_info[0], sys.version_info[1], getattr(e, "msg", None) or str(e))
    try:
        name = codecs.lookup(declared).name
    except LookupError:
        return "the file declares the encoding `%s`, which Python does not know" % declared
    if name not in ("utf-8", "utf-8-sig"):
        return "the file declares the encoding `%s` (PEP 263); saidvsdid reads only UTF-8 source" % declared
    return None


def analyse(data):
    why = encoding_doubt(data)
    if why is not None:
        return {"ok": False, "why": why}
    try:
        f = File(data)
    except (SyntaxError, ValueError, RecursionError, MemoryError, LookupError, UnicodeError) as e:
        line = getattr(e, "lineno", None)
        return {"ok": False, "why": "Python %d.%d does not compile it: %s%s" % (sys.version_info[0], sys.version_info[1], getattr(e, "msg", None) or str(e), " (line %d)" % line if line else "")}
    try:
        return {
            "ok": True,
            "names": f.names(),
            "aliases": f.aliases(),
            "methods": f.methods(),
            "bound": f.bound(),
            "written": f.written_attrs,
            "literals": f.literals(),
            "binds": f.binds(),
            "star": f.star,
            "dynamic": f.dynamic(),
            "classes": f.classes(),
        }
    except Exception as e:  # a file this script cannot read is a WARN of its own, never the batch's failure
        return {"ok": False, "why": "the scope reader failed on it: %s: %s" % (type(e).__name__, e)}


def main():
    request = json.loads(sys.stdin.buffer.read())
    version = "%d.%d.%d" % sys.version_info[:3]
    why = None
    if sys.version_info[:2] < MINIMUM:
        why = "Python %s is older than the oldest supported version (%d.%d)" % ((version,) + MINIMUM)
    else:
        why = self_check()
    files = {}
    if why is None:
        for item in request.get("files", []):
            files[item["id"]] = analyse(base64.b64decode(item["source"]))
    tested = sys.version_info[:2] in TESTED
    sys.stdout.buffer.write(json.dumps({"protocol": PROTOCOL, "python": version, "supported": why is None, "tested": tested, "why": why, "files": files}, ensure_ascii=True).encode("ascii"))


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-check"]:
        print(json.dumps({"python": "%d.%d.%d" % sys.version_info[:3], "why": self_check(), "classes": sorted(n for n in node_classes() if n not in ABSTRACT)}))
    else:
        main()
