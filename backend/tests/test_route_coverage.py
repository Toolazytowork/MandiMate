"""Route coverage: ``docs/API_CONTRACT.md`` ↔ the FastAPI app ↔ ``frontend/src/lib/api/*.ts``.

Every endpoint row of the contract is parsed (method, path with ``{id}`` params normalised,
documented query parameters, request and response cells) and checked against the routes the
app registers under ``/api/v1`` (health also at the root) and against the OpenAPI document:
status code, response model name, request body and query parameters. The frontend API
modules are parsed too, so a call to an undocumented path, a wrong method, a query parameter
the backend ignores or a response type that differs from the contract fails here.

Field-level shapes are covered by ``test_contract.py``; this module checks that the routes use
exactly those contract-tested schema classes.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, get_args

import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel
from starlette.routing import compile_path

from app import schemas
from app.api.v1.router import AREA_ROUTERS, HealthStatus, health_router
from app.api.v1.routes.public import ContactAck
from app.core.config import settings
from app.main import app

REPO = Path(__file__).resolve().parents[2]
CONTRACT_DOC = REPO / "docs" / "API_CONTRACT.md"
TYPES_TS = REPO / "frontend" / "src" / "types" / "api.ts"
FRONTEND_API_DIR = REPO / "frontend" / "src" / "lib" / "api"

PREFIX = settings.API_PREFIX
METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})
PATH_PARAM = re.compile(r"\{[^}]*\}|\$\{[^}]*\}")
CODE_SPAN = re.compile(r"`([^`]+)`")
SAMPLE_ID = "00000000-0000-4000-8000-000000000000"
INLINE_OK = "{ok:true}"

# Route models that deliberately live outside ``app.schemas`` (and so outside test_contract.py),
# mapped to the contract-tested schema whose fields they must mirror (None: inline contract shape).
LOCAL_ROUTE_MODELS: dict[type[BaseModel], type[BaseModel] | None] = {
    HealthStatus: schemas.HealthStatus,
    ContactAck: None,
}


def normalise(path: str) -> str:
    """``/lots/{id}/members/{member_id}`` and ``/lots/${id}/members/${memberId}`` → ``/lots/{}/members/{}``."""
    return PATH_PARAM.sub("{}", path)


# ───────────────────────────── Contract document ─────────────────────────────


@dataclass(frozen=True)
class ContractEndpoint:
    method: str
    path: str  # normalised, relative to the API prefix
    query: tuple[str, ...]
    request: str | None  # TS type name, "multipart:<field>" or None
    status: int
    response: str | None  # TS type name ("X[]" for lists), INLINE_OK, or None for no body

    @property
    def key(self) -> tuple[str, str]:
        return self.method, self.path

    def __str__(self) -> str:
        return f"{self.method} {self.path}"


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _first_span(cell: str) -> str | None:
    match = CODE_SPAN.search(cell)
    return match.group(1).strip() if match else None


def _parse_request(cell: str | None) -> str | None:
    if cell is None or cell in {"—", "-", ""}:
        return None
    span = _first_span(cell)
    assert span, f"Unparseable request cell: {cell!r}"
    if cell.startswith("multipart"):
        return f"multipart:{span}"
    assert re.fullmatch(r"\w+", span), f"Unparseable request cell: {cell!r}"
    return span


def _parse_response(cell: str) -> tuple[int, str | None]:
    span = _first_span(cell)
    assert span, f"Unparseable response cell: {cell!r}"
    if span.startswith("{"):
        assert re.sub(r"[\s\"]", "", span) == INLINE_OK, f"Unknown inline response: {span!r}"
        return 200, INLINE_OK
    match = re.fullmatch(r"(?:(\d{3})\s*)?(\w+(?:\[\])?)?", span)
    assert match and (match.group(1) or match.group(2)), f"Unparseable response cell: {cell!r}"
    status, name = match.groups()
    return int(status or 200), name


@cache
def contract_endpoints() -> tuple[ContractEndpoint, ...]:
    endpoints: list[ContractEndpoint] = []
    columns: dict[str, int] | None = None
    for line in CONTRACT_DOC.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            columns = None
            continue
        cells = _cells(line)
        if cells[0] == "Method":
            columns = {name: index for index, name in enumerate(cells)}
            continue
        if columns is None or set(cells[0]) <= set("-: "):
            continue
        method = cells[columns["Method"]]
        assert method in METHODS, f"Unknown method in contract row: {line!r}"
        raw_path = _first_span(cells[columns["Path"]])
        assert raw_path and raw_path.startswith("/"), f"Unparseable path in: {line!r}"
        path, _, query = raw_path.partition("?")
        request_col = columns.get("Request")
        status, response = _parse_response(cells[columns["Response"]])
        endpoints.append(
            ContractEndpoint(
                method=method,
                path=normalise(path),
                query=tuple(re.findall(r"(\w+)=", query)),
                request=_parse_request(cells[request_col] if request_col is not None else None),
                status=status,
                response=response,
            )
        )
    return tuple(endpoints)


@cache
def ts_exports() -> tuple[frozenset[str], dict[str, str]]:
    """Names exported by api.ts and the plain ``export type A = B;`` aliases."""
    source = TYPES_TS.read_text(encoding="utf-8")
    names = frozenset(re.findall(r"^export (?:interface|type) (\w+)", source, re.M))
    aliases = dict(re.findall(r"^export type (\w+) = (\w+);", source, re.M))
    return names, aliases


def resolve_alias(name: str) -> str:
    aliases = ts_exports()[1]
    while name in aliases:
        name = aliases[name]
    return name


def endpoint_params(*, with_query: bool = False) -> list[Any]:
    return [
        pytest.param(endpoint, id=str(endpoint))
        for endpoint in contract_endpoints()
        if endpoint.query or not with_query
    ]


# ───────────────────────────── Backend (OpenAPI) ─────────────────────────────


@cache
def openapi() -> dict[str, Any]:
    return app.openapi()


@cache
def backend_operations() -> dict[tuple[str, str], dict[str, Any]]:
    """``(METHOD, normalised full path)`` → OpenAPI operation."""
    operations: dict[tuple[str, str], dict[str, Any]] = {}
    for path, item in openapi()["paths"].items():
        for method, operation in item.items():
            key = (method.upper(), normalise(path))
            assert key not in operations, f"Two routes registered for {key}"
            operations[key] = operation
    return operations


def operation_for(endpoint: ContractEndpoint) -> dict[str, Any]:
    key = (endpoint.method, PREFIX + endpoint.path)
    assert key in backend_operations(), f"{endpoint} is not registered under {PREFIX}"
    return backend_operations()[key]


def query_parameters(endpoint: ContractEndpoint) -> set[str]:
    parameters = operation_for(endpoint).get("parameters", [])
    return {parameter["name"] for parameter in parameters if parameter["in"] == "query"}


def schema_name(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]
    if schema.get("type") == "array":
        return schema_name(schema["items"]) + "[]"
    if "anyOf" in schema:
        members = [s for s in schema["anyOf"] if s.get("type") != "null"]
        if len(members) == 1:
            return schema_name(members[0])
    return repr(schema)


def component(name: str) -> dict[str, Any]:
    return openapi()["components"]["schemas"][name]


@cache
def registered_routes() -> tuple[tuple[str, str], ...]:
    """``(METHOD, full path)`` of every API route, in the order the app tries them."""
    groups = [(health_router, ""), (health_router, PREFIX)]
    groups += [(router, PREFIX) for router in AREA_ROUTERS]
    routes: list[tuple[str, str]] = []
    for router, prefix in groups:
        for route in router.routes:
            assert isinstance(route, APIRoute), f"Unexpected nested route {route!r}"
            routes += [(method, prefix + route.path) for method in sorted(route.methods)]
    return tuple(routes)


# ───────────────────────────── Contract ↔ backend ────────────────────────────


def test_contract_document_parses_into_unique_endpoints() -> None:
    endpoints = contract_endpoints()
    keys = [endpoint.key for endpoint in endpoints]

    assert len(endpoints) >= 90
    assert len(keys) == len(set(keys)), "Duplicate endpoint rows in API_CONTRACT.md"


@pytest.mark.parametrize("endpoint", endpoint_params())
def test_contract_endpoint_is_registered_under_the_api_prefix(endpoint: ContractEndpoint) -> None:
    operation_for(endpoint)
    if endpoint.path == "/health":
        assert ("GET", "/health") in backend_operations(), "health is not mounted at the root"


def test_backend_registers_no_endpoint_outside_the_contract() -> None:
    documented = {(e.method, PREFIX + e.path) for e in contract_endpoints()}
    documented.add(("GET", "/health"))

    assert set(backend_operations()) - documented == set()


def test_route_order_mirror_matches_the_app() -> None:
    """``registered_routes`` (used for the shadowing check) must describe the real app."""
    assert {(m, normalise(p)) for m, p in registered_routes()} == set(backend_operations())


@pytest.mark.parametrize("endpoint", endpoint_params())
def test_contract_path_is_not_shadowed_by_an_earlier_route(endpoint: ContractEndpoint) -> None:
    concrete = PREFIX + endpoint.path.replace("{}", SAMPLE_ID)
    first = next(
        path
        for method, path in registered_routes()
        if method == endpoint.method and compile_path(path)[0].match(concrete)
    )

    assert normalise(first) == PREFIX + endpoint.path


@pytest.mark.parametrize("endpoint", endpoint_params())
def test_status_code_and_response_model_match_the_contract(endpoint: ContractEndpoint) -> None:
    responses = operation_for(endpoint)["responses"]
    success = [code for code in responses if code.startswith("2")]

    assert success == [str(endpoint.status)]
    content = responses[success[0]].get("content", {})
    if endpoint.response is None:
        assert content == {}, f"{endpoint} must not declare a response body"
        return
    schema = content["application/json"]["schema"]
    if endpoint.response == INLINE_OK:
        ack = component(schema_name(schema))
        assert ack["properties"].keys() == {"ok"}
        assert ack["properties"]["ok"].get("const") is True
        return
    assert endpoint.response.removesuffix("[]") in ts_exports()[0]
    assert schema_name(schema) == endpoint.response


@pytest.mark.parametrize("endpoint", endpoint_params())
def test_request_body_matches_the_contract(endpoint: ContractEndpoint) -> None:
    body = operation_for(endpoint).get("requestBody")

    if endpoint.request is None:
        assert body is None, f"{endpoint} accepts an undocumented request body"
        return
    assert body is not None, f"{endpoint} does not accept its {endpoint.request} body"
    if endpoint.request.startswith("multipart:"):
        form = body["content"]["multipart/form-data"]["schema"]
        field = endpoint.request.removeprefix("multipart:")
        assert component(schema_name(form))["required"] == [field]
        return
    assert endpoint.request in ts_exports()[0]
    schema = body["content"]["application/json"]["schema"]
    assert schema_name(schema) == resolve_alias(endpoint.request)


@pytest.mark.parametrize("endpoint", endpoint_params(with_query=True))
def test_documented_query_parameters_are_accepted(endpoint: ContractEndpoint) -> None:
    assert set(endpoint.query) <= query_parameters(endpoint)


def _models(annotation: Any) -> Iterator[type[BaseModel]]:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield annotation
    for arg in get_args(annotation):
        yield from _models(arg)


def _field_signature(model: type[BaseModel]) -> dict[str, tuple[Any, bool]]:
    return {name: (f.annotation, f.is_required()) for name, f in model.model_fields.items()}


def test_routes_use_the_contract_tested_schema_classes() -> None:
    strays: list[str] = []
    for router in (health_router, *AREA_ROUTERS):
        for route in router.routes:
            assert isinstance(route, APIRoute)
            annotations = [route.response_model]
            annotations += [param.field_info.annotation for param in route.dependant.body_params]
            for model in (m for a in annotations for m in _models(a)):
                if getattr(schemas, model.__name__, None) is model:
                    continue
                if model in LOCAL_ROUTE_MODELS:
                    mirror = LOCAL_ROUTE_MODELS[model]
                    if mirror is None or _field_signature(model) == _field_signature(mirror):
                        continue
                if model.__name__.startswith("Body_"):
                    continue
                strays.append(
                    f"{sorted(route.methods)} {route.path}: {model.__module__}.{model.__name__}"
                )

    assert strays == []


# ───────────────────────────── Frontend ↔ contract ───────────────────────────

CALL = re.compile(
    r"apiFetch<(?P<type>[^(]+?)>\(\s*(?P<quote>['`])(?P<path>.+?)(?P=quote)"
    r"\s*(?:,\s*\{(?P<options>.*?)\}\s*)?\)",
    re.S,
)
MEMBER = re.compile(r"^  (\w+): (?:\(|async)", re.M)


@dataclass(frozen=True)
class FrontendCall:
    location: str
    method: str
    path: str  # normalised
    response: str
    request: str | None  # TS type of the ``req`` argument, "FormData", or None
    sends_body: bool
    query_params: str | None  # name of the ``*Params`` interface spread into ``query``


@cache
def frontend_params() -> dict[str, frozenset[str]]:
    params: dict[str, frozenset[str]] = {}
    for file in FRONTEND_API_DIR.glob("*.ts"):
        source = file.read_text(encoding="utf-8")
        for name, body in re.findall(r"export interface (\w+Params) \{(.*?)\n\}", source, re.S):
            params[name] = frozenset(re.findall(r"^\s+(\w+)\?:", body, re.M))
    return params


@cache
def frontend_calls() -> tuple[FrontendCall, ...]:
    calls: list[FrontendCall] = []
    for file in sorted(FRONTEND_API_DIR.glob("*.ts")):
        if file.name.endswith(".test.ts"):
            continue
        source = file.read_text(encoding="utf-8")
        for match in CALL.finditer(source):
            members = list(MEMBER.finditer(source, 0, match.start()))
            signature = source[members[-1].start() : match.start()] if members else ""
            options = match.group("options") or ""
            method = re.search(r"method:\s*'(\w+)'", options)
            req = re.search(r"\breq: (\w+)", signature)
            params = re.search(r"\bparams: (\w+Params)", signature)
            line = source.count("\n", 0, match.start()) + 1
            calls.append(
                FrontendCall(
                    location=f"{file.name}:{line}",
                    method=method.group(1) if method else "GET",
                    path=normalise(match.group("path")),
                    response=re.sub(r"\s", "", match.group("type")),
                    request="FormData" if "FormData" in signature else req and req.group(1),
                    sends_body=re.search(r"\bbody\b", options) is not None,
                    query_params=params.group(1) if "query:" in options and params else None,
                )
            )
        # The refresh call goes through the low-level ``send`` so it can skip the 401 retry.
        for path, method in re.findall(r"\bsend\('([^']+)',\s*\{\s*method:\s*'(\w+)'", source):
            calls.append(
                FrontendCall(f"{file.name}", method, path, "AuthResponse", None, False, None)
            )
    return tuple(calls)


def test_frontend_api_modules_parse() -> None:
    assert len(frontend_calls()) >= 90


def test_frontend_calls_only_contract_endpoints() -> None:
    documented = {endpoint.key for endpoint in contract_endpoints()}
    unknown = [
        f"{c.location} {c.method} {c.path}"
        for c in frontend_calls()
        if (c.method, c.path) not in documented
    ]

    assert unknown == []


def test_every_contract_endpoint_has_a_frontend_call() -> None:
    called = {(call.method, call.path) for call in frontend_calls()}

    assert [str(e) for e in contract_endpoints() if e.key not in called] == []


def _contract_by_key() -> dict[tuple[str, str], ContractEndpoint]:
    return {endpoint.key: endpoint for endpoint in contract_endpoints()}


def test_frontend_response_and_request_types_match_the_contract() -> None:
    mismatches: list[str] = []
    for call in frontend_calls():
        endpoint = _contract_by_key().get((call.method, call.path))
        if endpoint is None:
            continue  # reported by test_frontend_calls_only_contract_endpoints
        expected_response = endpoint.response or "void"
        if call.response != expected_response:
            mismatches.append(
                f"{call.location} {endpoint}: response {call.response} != {expected_response}"
            )
        if endpoint.request is None:
            if call.sends_body:
                mismatches.append(
                    f"{call.location} {endpoint}: sends a body the contract does not define"
                )
            continue
        expected_request = (
            "FormData" if endpoint.request.startswith("multipart:") else endpoint.request
        )
        if not call.sends_body or call.request != expected_request:
            mismatches.append(
                f"{call.location} {endpoint}: request {call.request} != {expected_request}"
            )

    assert mismatches == []


def test_frontend_query_parameters_are_accepted_by_the_backend() -> None:
    ignored: list[str] = []
    for call in frontend_calls():
        if call.query_params is None:
            continue
        endpoint = _contract_by_key().get((call.method, call.path))
        if endpoint is None:
            continue
        sent = frontend_params()[call.query_params]
        if sent - query_parameters(endpoint):
            ignored.append(
                f"{call.location} {endpoint}: {sorted(sent - query_parameters(endpoint))}"
            )

    assert ignored == []
