"""Frontend/backend contract: ``app.schemas`` must mirror ``frontend/src/types/api.ts``.

The TypeScript contract is tokenised with regular expressions and parsed in full (an
unsupported construct fails loudly instead of being skipped). For every exported
interface and object type alias there must be a schema class with the same name and
exactly the same fields, optionality, nullability and JSON shape; for every exported
string union there must be a ``Literal`` alias with the same values in the same order.

The last section checks the request validation rules that are part of the API contract.
"""

import re
import types
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any, Literal, Union, get_args, get_origin

import pytest
from pydantic import BaseModel, EmailStr, ValidationError

from app import schemas

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "types" / "api.ts"

# Generic TypeScript helper declarations (e.g. ``Page<T>``) that have no schema of their own.
SKIPPED_DECLARATIONS: frozenset[str] = frozenset()

# TS scalar aliases (``export type UUID = string``) and the Python type each must map to.
SCALAR_ALIASES: dict[str, type] = {"UUID": uuid.UUID, "ISODate": date, "ISODateTime": datetime}

PRIMITIVES: dict[str, tuple[Any, ...]] = {
    "string": (str, EmailStr),
    "number": (int, float),
    "boolean": (bool,),
}

# ───────────────────────────── TypeScript model ─────────────────────────────


@dataclass(frozen=True)
class TsRef:
    name: str


@dataclass(frozen=True)
class TsLiteral:
    value: str


@dataclass(frozen=True)
class TsUnion:
    members: tuple["TsNode", ...]


@dataclass(frozen=True)
class TsIntersection:
    members: tuple["TsNode", ...]


@dataclass(frozen=True)
class TsArray:
    element: "TsNode"


@dataclass(frozen=True)
class TsTuple:
    elements: tuple["TsNode", ...]


@dataclass(frozen=True)
class TsGeneric:
    name: str
    args: tuple["TsNode", ...]


@dataclass(frozen=True)
class TsKeyOf:
    target: "TsNode"


@dataclass(frozen=True)
class TsMember:
    name: str
    optional: bool
    type: "TsNode"


@dataclass(frozen=True)
class TsObject:
    members: tuple[TsMember, ...]


TsNode = (
    TsRef
    | TsLiteral
    | TsUnion
    | TsIntersection
    | TsArray
    | TsTuple
    | TsGeneric
    | TsKeyOf
    | TsObject
)

NULL = TsRef("null")


@dataclass(frozen=True)
class TsDeclaration:
    name: str
    kind: Literal["interface", "type"]
    type_params: tuple[str, ...]
    bases: tuple[str, ...]
    body: TsNode


_TOKEN = re.compile(r"\s*(?:('[^']*')|([A-Za-z_]\w*)|([|&<>,\[\](){};:?=]))")


def _tokenize(source: str) -> list[str]:
    tokens: list[str] = []
    position = 0
    source = source.rstrip()
    while position < len(source):
        match = _TOKEN.match(source, position)
        if match is None:
            raise SyntaxError(f"Unexpected input in api.ts: {source[position : position + 40]!r}")
        tokens.append(match.group(match.lastindex or 0))
        position = match.end()
    return tokens


def _strip_comments(source: str) -> str:
    source = re.sub(r"/\*.*?\*/", " ", source, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", " ", source)


class _Parser:
    def __init__(self, source: str) -> None:
        self.tokens = _tokenize(_strip_comments(source))
        self.position = 0

    def at_end(self) -> bool:
        return self.position >= len(self.tokens)

    def peek(self, offset: int = 0) -> str | None:
        index = self.position + offset
        return self.tokens[index] if index < len(self.tokens) else None

    def take(self, expected: str | None = None) -> str:
        token = self.peek()
        if token is None or (expected is not None and token != expected):
            raise SyntaxError(f"api.ts: expected {expected!r}, found {token!r}")
        self.position += 1
        return token

    def declarations(self) -> Iterator[TsDeclaration]:
        while not self.at_end():
            self.take("export")
            kind = self.take()
            name = self.take()
            type_params = self._type_params()
            if kind == "interface":
                bases: list[str] = []
                if self.peek() == "extends":
                    self.take()
                    bases.append(self.take())
                    while self.peek() == ",":
                        self.take()
                        bases.append(self.take())
                self.take("{")
                body = TsObject(self._members())
                yield TsDeclaration(name, "interface", type_params, tuple(bases), body)
            elif kind == "type":
                self.take("=")
                body = self.type()
                self.take(";")
                yield TsDeclaration(name, "type", type_params, (), body)
            else:
                raise SyntaxError(f"api.ts: unsupported declaration 'export {kind} {name}'")

    def _type_params(self) -> tuple[str, ...]:
        if self.peek() != "<":
            return ()
        self.take("<")
        params = [self.take()]
        while self.peek() == ",":
            self.take()
            params.append(self.take())
        self.take(">")
        return tuple(params)

    def _members(self) -> tuple[TsMember, ...]:
        members: list[TsMember] = []
        while self.peek() != "}":
            name = self.take()
            optional = self.peek() == "?"
            if optional:
                self.take()
            self.take(":")
            members.append(TsMember(name, optional, self.type()))
            if self.peek() in (";", ","):
                self.take()
        self.take("}")
        return tuple(members)

    def type(self) -> TsNode:
        if self.peek() == "|":
            self.take()
        members = [self._intersection()]
        while self.peek() == "|":
            self.take()
            members.append(self._intersection())
        return members[0] if len(members) == 1 else TsUnion(tuple(members))

    def _intersection(self) -> TsNode:
        members = [self._postfix()]
        while self.peek() == "&":
            self.take()
            members.append(self._postfix())
        return members[0] if len(members) == 1 else TsIntersection(tuple(members))

    def _postfix(self) -> TsNode:
        node = self._primary()
        while self.peek() == "[" and self.peek(1) == "]":
            self.take("[")
            self.take("]")
            node = TsArray(node)
        return node

    def _primary(self) -> TsNode:
        token = self.take()
        if token.startswith("'"):
            return TsLiteral(token[1:-1])
        if token == "(":
            node = self.type()
            self.take(")")
            return node
        if token == "[":
            elements = [self.type()]
            while self.peek() == ",":
                self.take()
                elements.append(self.type())
            self.take("]")
            return TsTuple(tuple(elements))
        if token == "{":
            return TsObject(self._members())
        if token == "keyof":
            return TsKeyOf(self._primary())
        if not re.fullmatch(r"[A-Za-z_]\w*", token):
            raise SyntaxError(f"api.ts: unexpected token {token!r}")
        if self.peek() == "<":
            self.take("<")
            args = [self.type()]
            while self.peek() == ",":
                self.take()
                args.append(self.type())
            self.take(">")
            return TsGeneric(token, tuple(args))
        return TsRef(token)


class Contract:
    """The parsed TypeScript contract with alias/inheritance resolution."""

    def __init__(self, source: str) -> None:
        self.declarations: dict[str, TsDeclaration] = {}
        for declaration in _Parser(source).declarations():
            assert declaration.name not in self.declarations, f"Duplicate {declaration.name}"
            self.declarations[declaration.name] = declaration
        checked = {
            name: declaration
            for name, declaration in self.declarations.items()
            if name not in SKIPPED_DECLARATIONS
        }
        self.union_aliases = {
            name: values
            for name, declaration in checked.items()
            if declaration.kind == "type"
            and (values := self.literal_values(declaration.body)) is not None
        }
        self.object_types = {
            name: fields
            for name, declaration in checked.items()
            if (fields := self.object_fields(TsRef(name))) is not None
        }

    def literal_values(self, node: TsNode) -> tuple[str, ...] | None:
        """The values of a string-literal union in declaration order (through aliases), else None."""
        match node:
            case TsLiteral(value):
                return (value,)
            case TsUnion(members):
                member_values = [self.literal_values(member) for member in members]
                if any(values is None for values in member_values):
                    return None
                return tuple(dict.fromkeys(v for values in member_values for v in values or ()))
            case TsRef(name) if name in self.declarations:
                declaration = self.declarations[name]
                return self.literal_values(declaration.body) if declaration.kind == "type" else None
            case TsGeneric("Exclude", (source, excluded)):
                source_values = self.literal_values(source)
                excluded_values = self.literal_values(excluded)
                if source_values is None or excluded_values is None:
                    return None
                return tuple(value for value in source_values if value not in excluded_values)
            case TsKeyOf(target):
                fields = self.object_fields(target)
                return None if fields is None else tuple(fields)
        return None

    def object_fields(self, node: TsNode) -> dict[str, TsMember] | None:
        """The fields of an object type (interfaces incl. inherited fields, Partial, Omit, &)."""
        match node:
            case TsObject(members):
                return {member.name: member for member in members}
            case TsRef(name) if name in self.declarations:
                declaration = self.declarations[name]
                if declaration.kind == "type":
                    return self.object_fields(declaration.body)
                fields: dict[str, TsMember] = {}
                for base in declaration.bases:
                    base_fields = self.object_fields(TsRef(base))
                    assert base_fields is not None, f"{name} extends unknown {base}"
                    fields.update(base_fields)
                fields.update(self.object_fields(declaration.body) or {})
                return fields
            case TsGeneric("Partial", (inner,)):
                inner_fields = self.object_fields(inner)
                if inner_fields is None:
                    return None
                return {
                    name: replace(member, optional=True) for name, member in inner_fields.items()
                }
            case TsGeneric("Omit", (inner, keys)):
                inner_fields = self.object_fields(inner)
                omitted = self.literal_values(keys)
                if inner_fields is None or omitted is None:
                    return None
                return {
                    name: member for name, member in inner_fields.items() if name not in omitted
                }
            case TsIntersection(members):
                merged: dict[str, TsMember] = {}
                for member in members:
                    member_fields = self.object_fields(member)
                    if member_fields is None:
                        return None
                    merged.update(member_fields)
                return merged
        return None


# ──────────────────────────── Shape comparison ─────────────────────────────


def _unwrap(annotation: Any) -> Any:
    while get_origin(annotation) is Annotated:
        annotation = get_args(annotation)[0]
    return annotation


def _python_alternatives(annotation: Any) -> list[Any]:
    annotation = _unwrap(annotation)
    if get_origin(annotation) in (Union, types.UnionType):
        return [alt for arg in get_args(annotation) for alt in _python_alternatives(arg)]
    return [annotation]


def _ts_alternatives(node: TsNode) -> list[TsNode]:
    if isinstance(node, TsUnion):
        return [alt for member in node.members for alt in _ts_alternatives(member)]
    return [node]


def _python_literal_values(alternatives: list[Any]) -> frozenset[Any] | None:
    values: set[Any] = set()
    for alternative in alternatives:
        if get_origin(alternative) is not Literal:
            return None
        values.update(get_args(alternative))
    return frozenset(values)


def compare_type(
    contract: Contract, node: TsNode, annotation: Any, where: str, *, optional: bool = False
) -> list[str]:
    """Differences between a TS type and a Python annotation (empty when they match)."""
    ts_alternatives = _ts_alternatives(node)
    py_alternatives = _python_alternatives(annotation)
    ts_nullable = NULL in ts_alternatives
    py_nullable = type(None) in py_alternatives
    ts_rest = [alt for alt in ts_alternatives if alt != NULL]
    py_rest = [alt for alt in py_alternatives if alt is not type(None)]

    problems: list[str] = []
    if ts_nullable and not py_nullable:
        problems.append(f"{where}: nullable in TS but not in Python")
    if py_nullable and not ts_nullable and not optional:
        problems.append(f"{where}: nullable in Python but not in TS")

    ts_values = contract.literal_values(TsUnion(tuple(ts_rest)))
    if ts_values is not None:
        py_values = _python_literal_values(py_rest)
        if py_values != frozenset(ts_values):
            problems.append(f"{where}: Python values {py_values} != TS values {set(ts_values)}")
        return problems

    if len(ts_rest) == 1 and len(py_rest) == 1:
        return problems + _compare_single(contract, ts_rest[0], py_rest[0], where)
    if len(ts_rest) != len(py_rest):
        return [*problems, f"{where}: {len(ts_rest)} TS alternatives, {len(py_rest)} in Python"]
    for ts_alternative in ts_rest:
        if all(_compare_single(contract, ts_alternative, alt, where) for alt in py_rest):
            problems.append(f"{where}: no Python alternative matches TS {ts_alternative}")
    return problems


def _compare_single(contract: Contract, node: TsNode, annotation: Any, where: str) -> list[str]:
    annotation = _unwrap(annotation)
    origin, args = get_origin(annotation), get_args(annotation)
    match node:
        case TsRef(name) if name in PRIMITIVES:
            if annotation not in PRIMITIVES[name]:
                return [f"{where}: TS {name} but Python {annotation!r}"]
            return []
        case TsRef(name) if name in SCALAR_ALIASES:
            if annotation is not SCALAR_ALIASES[name]:
                return [f"{where}: TS {name} must be {SCALAR_ALIASES[name]!r}, got {annotation!r}"]
            return []
        case TsRef(name) if name in contract.object_types:
            if annotation is not getattr(schemas, name, None):
                return [f"{where}: TS {name} but Python {annotation!r}"]
            return []
        case TsArray(element):
            if origin is not list:
                return [f"{where}: TS array but Python {annotation!r}"]
            return compare_type(contract, element, args[0], f"{where}[]")
        case TsTuple(elements):
            if origin is not tuple or len(args) != len(elements):
                return [f"{where}: TS {len(elements)}-tuple but Python {annotation!r}"]
            return [
                problem
                for index, (element, arg) in enumerate(zip(elements, args, strict=True))
                for problem in compare_type(contract, element, arg, f"{where}[{index}]")
            ]
        case TsGeneric("Partial", (TsGeneric("Record", _) as record,)):
            return _compare_single(contract, record, annotation, where)
        case TsGeneric("Record", (key, value)):
            if origin is not dict or args[0] is not str:
                return [f"{where}: TS Record but Python {annotation!r}"]
            if contract.literal_values(key) is None and key != TsRef("string"):
                return [f"{where}: unsupported Record key {key}"]
            return compare_type(contract, value, args[1], f"{where}{{}}")
        case TsObject(members):
            if not (isinstance(annotation, type) and issubclass(annotation, BaseModel)):
                return [f"{where}: TS inline object but Python {annotation!r}"]
            return compare_fields({m.name: m for m in members}, annotation, where, contract)
    return [f"{where}: unsupported TS type {node}"]


def compare_fields(
    fields: dict[str, TsMember], model: type[BaseModel], where: str, contract: Contract
) -> list[str]:
    problems: list[str] = []
    ts_names, py_names = set(fields), set(model.model_fields)
    if ts_names != py_names:
        problems.append(
            f"{where}: missing {sorted(ts_names - py_names)}, unexpected {sorted(py_names - ts_names)}"
        )
    for name in sorted(ts_names & py_names):
        member, info = fields[name], model.model_fields[name]
        if member.optional == info.is_required():
            ts_side = "optional" if member.optional else "required"
            py_side = "required" if info.is_required() else "optional"
            problems.append(f"{where}.{name}: {ts_side} in TS but {py_side} in Python")
        problems += compare_type(
            contract, member.type, info.annotation, f"{where}.{name}", optional=member.optional
        )
    return problems


# ─────────────────────────────── Contract tests ────────────────────────────────

assert CONTRACT_PATH.is_file(), f"API contract not found at {CONTRACT_PATH}"
CONTRACT = Contract(CONTRACT_PATH.read_text(encoding="utf-8"))
INTERFACES_WITH_BASES = sorted(
    name
    for name, declaration in CONTRACT.declarations.items()
    if declaration.bases and name not in SKIPPED_DECLARATIONS
)


def _schema_model(name: str) -> type[BaseModel]:
    model = getattr(schemas, name, None)
    assert isinstance(model, type), f"app.schemas has no class {name}"
    assert issubclass(model, BaseModel), f"app.schemas.{name} is not a Pydantic model"
    return model


def test_only_listed_declarations_are_skipped() -> None:
    generic = {name for name, decl in CONTRACT.declarations.items() if decl.type_params}
    assert generic <= SKIPPED_DECLARATIONS, f"Generic declarations to review: {generic}"
    assert set(CONTRACT.declarations) >= SKIPPED_DECLARATIONS, "Stale entries in the skip-list"


def test_every_declaration_is_classified() -> None:
    classified = set(CONTRACT.union_aliases) | set(CONTRACT.object_types) | set(SCALAR_ALIASES)
    unclassified = set(CONTRACT.declarations) - classified - SKIPPED_DECLARATIONS
    assert not unclassified, (
        f"api.ts declarations the contract test does not understand: {unclassified}"
    )


def test_exports_are_unique() -> None:
    assert len(schemas.__all__) == len(set(schemas.__all__))
    missing = [name for name in schemas.__all__ if not hasattr(schemas, name)]
    assert not missing, f"__all__ names that do not exist: {missing}"


@pytest.mark.parametrize("name", sorted(CONTRACT.object_types))
def test_schema_has_exactly_the_contract_fields(name: str) -> None:
    model = _schema_model(name)
    assert name in schemas.__all__, f"{name} is not re-exported from app.schemas"
    ts_fields = set(CONTRACT.object_types[name])
    py_fields = set(model.model_fields)
    assert py_fields == ts_fields, (
        f"{name}: missing {sorted(ts_fields - py_fields)}, unexpected {sorted(py_fields - ts_fields)}"
    )


@pytest.mark.parametrize("name", sorted(CONTRACT.object_types))
def test_schema_field_types_match_the_contract(name: str) -> None:
    problems = compare_fields(CONTRACT.object_types[name], _schema_model(name), name, CONTRACT)
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize("name", INTERFACES_WITH_BASES)
def test_schema_inheritance_mirrors_extends(name: str) -> None:
    model = _schema_model(name)
    for base in CONTRACT.declarations[name].bases:
        assert issubclass(model, _schema_model(base)), f"{name} must subclass {base}"


@pytest.mark.parametrize("name", sorted(CONTRACT.union_aliases))
def test_literal_alias_matches_the_union(name: str) -> None:
    assert name in schemas.__all__, f"{name} is not re-exported from app.schemas"
    alias = getattr(schemas, name)
    assert get_origin(alias) is Literal, f"app.schemas.{name} is not a Literal alias"
    # Same values in the same order: services iterate get_args() (e.g. JourneyKey step order).
    assert get_args(alias) == CONTRACT.union_aliases[name]


# ──────────────────────────── Request validation ─────────────────────────────

CROP_ID = "6f1c2a8e-3b5d-4c7e-9a1f-2b3c4d5e6f70"
LOT_ID = "0b8f6d2e-1a3c-4e5f-8a7b-9c0d1e2f3a4b"
HARVEST_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


def _error_types(error: pytest.ExceptionInfo[ValidationError]) -> set[str]:
    return {issue["type"] for issue in error.value.errors()}


def _harvest_body(**overrides: Any) -> dict[str, Any]:
    body = {
        "crop_id": CROP_ID,
        "quantity_kg": 400,
        "harvest_date": "2026-10-27",
        "available_from": "2026-10-28",
        "sell_by": "2026-11-02",
    }
    return body | overrides


def _offer_body(**overrides: Any) -> dict[str, Any]:
    body = {
        "target_type": "lot",
        "lot_id": LOT_ID,
        "price_per_kg": 16.5,
        "quantity_kg": 1000,
        "pickup_terms": "mandimate_delivery",
        "delivery_location": "Hyderabad wholesale market",
        "payment_terms_days": 7,
        "max_rejection_pct": 5,
        "valid_until": "2026-11-01T12:00:00Z",
    }
    return body | overrides


def test_signup_requires_email_or_phone() -> None:
    base = {"full_name": "Ravi Kumar", "password": "tomato2026", "role": "farmer"}
    with pytest.raises(ValidationError) as error:
        schemas.SignupRequest.model_validate(base | {"email": "  "})
    assert _error_types(error) == {"contact_required"}

    by_phone = schemas.SignupRequest.model_validate(base | {"phone": "+91 98765-43210"})
    assert by_phone.phone == "+919876543210"
    assert by_phone.email is None
    assert by_phone.preferred_language == "en"


@pytest.mark.parametrize("language", ["en", "hi", "te", "kn", "ur"])
def test_every_supported_language_is_accepted(language: str) -> None:
    base = {"full_name": "Ravi Kumar", "password": "tomato2026", "role": "farmer"}
    signup = schemas.SignupRequest.model_validate(
        base | {"phone": "+919876543210", "preferred_language": language}
    )
    assert signup.preferred_language == language
    patch = schemas.UpdateProfileRequest.model_validate({"preferred_language": language})
    assert patch.preferred_language == language
    voice = schemas.VoiceListingRequest.model_validate(
        {"transcript": "400 kilos of tomatoes", "language": language}
    )
    assert voice.language == language


@pytest.mark.parametrize("language", ["ta", "KN", "urdu", ""])
def test_unsupported_language_is_rejected(language: str) -> None:
    with pytest.raises(ValidationError):
        schemas.UpdateProfileRequest.model_validate({"preferred_language": language})


def test_signup_validates_email_password_and_organization() -> None:
    base = {"full_name": "Asha Rao", "email": "asha@example.com", "role": "buyer"}
    with pytest.raises(ValidationError) as error:
        schemas.SignupRequest.model_validate(base | {"password": "freshveg1"})
    assert _error_types(error) == {"organization_required"}

    with pytest.raises(ValidationError) as error:
        schemas.SignupRequest.model_validate(
            base | {"password": "onlyletters", "organization_name": "Fresh Mart"}
        )
    assert _error_types(error) == {"password_too_weak"}

    with pytest.raises(ValidationError) as error:
        schemas.SignupRequest.model_validate(
            base | {"email": "not-an-email", "password": "freshveg1", "organization_name": "Mart"}
        )
    assert {issue["loc"] for issue in error.value.errors()} == {("email",)}


def test_login_identifier_is_stripped() -> None:
    login = schemas.LoginRequest.model_validate(
        {"identifier": "  ravi@example.com ", "password": "x"}
    )
    assert login.identifier == "ravi@example.com"


def test_harvest_defaults_and_date_order() -> None:
    harvest = schemas.HarvestCreateRequest.model_validate(_harvest_body(variety="  "))
    assert (harvest.grade, harvest.status, harvest.source) == ("ungraded", "listed", "manual")
    assert harvest.variety is None

    with pytest.raises(ValidationError) as error:
        schemas.HarvestCreateRequest.model_validate(_harvest_body(sell_by="2026-10-27"))
    assert _error_types(error) == {"sell_by_before_available_from"}
    assert error.value.errors()[0]["loc"] == ("sell_by",)

    with pytest.raises(ValidationError) as error:
        schemas.HarvestCreateRequest.model_validate(
            _harvest_body(available_from="2026-10-20", sell_by="2026-10-25")
        )
    assert _error_types(error) == {"sell_by_before_harvest_date"}


@pytest.mark.parametrize(
    ("field", "value", "error_type"),
    [
        ("quantity_kg", 0, "greater_than"),
        ("quantity_kg", 1_000_001, "less_than_equal"),
        ("min_price_per_kg", 0, "greater_than"),
        ("min_price_per_kg", 100_001, "less_than_equal"),
        ("latitude", 91, "less_than_equal"),
    ],
)
def test_harvest_numeric_bounds(field: str, value: float, error_type: str) -> None:
    body = _harvest_body(**{field: value})
    if field == "latitude":
        body["longitude"] = 78.5
    with pytest.raises(ValidationError) as error:
        schemas.HarvestCreateRequest.model_validate(body)
    assert _error_types(error) == {error_type}


def test_coordinates_must_be_sent_together() -> None:
    with pytest.raises(ValidationError) as error:
        schemas.HarvestCreateRequest.model_validate(_harvest_body(latitude=13.55))
    assert _error_types(error) == {"coordinates_incomplete"}
    both = schemas.HarvestCreateRequest.model_validate(
        _harvest_body(latitude=13.55, longitude=78.5)
    )
    assert (both.latitude, both.longitude) == (13.55, 78.5)


def test_patch_bodies_reject_null_for_required_columns() -> None:
    with pytest.raises(ValidationError) as error:
        schemas.HarvestUpdateRequest.model_validate({"quantity_kg": None})
    assert _error_types(error) == {"null_not_allowed"}

    patch = schemas.HarvestUpdateRequest.model_validate({"min_price_per_kg": None, "grade": "A"})
    assert patch.model_dump(exclude_unset=True) == {"min_price_per_kg": None, "grade": "A"}


def test_demand_minimum_cannot_exceed_quantity() -> None:
    body = {
        "crop_id": CROP_ID,
        "grade_required": "A",
        "quantity_kg": 1000,
        "min_quantity_kg": 1200,
        "delivery_location": "Bengaluru",
        "needed_by": "2026-11-05",
        "payment_terms_days": 7,
    }
    with pytest.raises(ValidationError) as error:
        schemas.DemandCreateRequest.model_validate(body)
    assert _error_types(error) == {"min_quantity_above_quantity"}

    with pytest.raises(ValidationError) as error:
        schemas.DemandCreateRequest.model_validate(
            body | {"min_quantity_kg": 800, "payment_terms_days": 181}
        )
    assert _error_types(error) == {"less_than_equal"}


def test_offer_target_must_match_target_type() -> None:
    offer = schemas.OfferCreateRequest.model_validate(_offer_body())
    assert offer.handling_charge_per_kg == 0
    assert offer.valid_until == datetime(2026, 11, 1, 12, tzinfo=UTC)

    with pytest.raises(ValidationError) as error:
        schemas.OfferCreateRequest.model_validate(_offer_body(lot_id=None))
    assert _error_types(error) == {"offer_target_required"}

    with pytest.raises(ValidationError) as error:
        schemas.OfferCreateRequest.model_validate(_offer_body(harvest_id=HARVEST_ID))
    assert _error_types(error) == {"offer_target_conflict"}

    direct = schemas.OfferCreateRequest.model_validate(
        _offer_body(target_type="harvest", lot_id=None, harvest_id=HARVEST_ID)
    )
    assert direct.harvest_id == uuid.UUID(HARVEST_ID)


def test_naive_request_datetimes_are_treated_as_utc() -> None:
    offer = schemas.OfferCreateRequest.model_validate(
        _offer_body(valid_until="2026-11-01T12:00:00")
    )
    assert offer.valid_until.tzinfo is UTC


def test_lot_and_delivery_reject_duplicates() -> None:
    member = {"harvest_id": HARVEST_ID, "quantity_kg": 200}
    lot_body = {
        "crop_id": CROP_ID,
        "grade": "A",
        "target_quantity_kg": 1000,
        "collection_point_name": "Madanapalle FPO yard",
        "collection_latitude": 13.55,
        "collection_longitude": 78.5,
        "pickup_date": "2026-10-30",
        "members": [member, member],
    }
    with pytest.raises(ValidationError) as error:
        schemas.LotCreateRequest.model_validate(lot_body)
    assert _error_types(error) == {"duplicate_harvest"}

    with pytest.raises(ValidationError) as error:
        schemas.DeliveryItemInput.model_validate(
            {"member_id": LOT_ID, "delivered_kg": 190, "accepted_kg": 195}
        )
    assert _error_types(error) == {"accepted_above_delivered"}


def test_voice_transcript_length() -> None:
    with pytest.raises(ValidationError):
        schemas.VoiceListingRequest.model_validate({"transcript": "   ", "language": "te"})
    with pytest.raises(ValidationError):
        schemas.VoiceListingRequest.model_validate({"transcript": "x" * 2001, "language": "en"})
    voice = schemas.VoiceListingRequest.model_validate(
        {"transcript": " 400 kilos of tomatoes tomorrow ", "language": "en"}
    )
    assert voice.transcript == "400 kilos of tomatoes tomorrow"


def test_vehicle_registration_is_canonical() -> None:
    vehicle = schemas.VehicleCreateRequest.model_validate(
        {
            "vehicle_type": "pickup",
            "registration_number": "ap 03-ta 1234",
            "capacity_kg": 1500,
            "base_charge": 900,
            "per_km_rate": 24,
        }
    )
    assert vehicle.registration_number == "AP03TA1234"
    assert vehicle.has_refrigeration is False


def test_join_lot_request_is_lot_member_input() -> None:
    assert schemas.JoinLotRequest is schemas.LotMemberInput
