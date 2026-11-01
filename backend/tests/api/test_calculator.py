"""POST /calculator/net-proceeds: the public net-proceeds estimate (DOMAIN_RULES §3)."""

from httpx import AsyncClient

from app.services.pricing import (
    CALCULATOR_LABEL,
    LINE_ORDER,
    PLATFORM_FEE_NOTE,
    estimate_transport_cost,
)

CALCULATOR = "/api/v1/calculator/net-proceeds"


def lines(body: dict) -> dict[str, dict]:
    return {line["key"]: line for line in body["lines"]}


async def test_net_proceeds_with_entered_transport_and_defaults(client: AsyncClient) -> None:
    response = await client.post(
        CALCULATOR, json={"quantity_kg": 1000, "price_per_kg": 15, "transport_cost_total": 1200}
    )

    assert response.status_code == 200
    body = response.json()
    by_key = lines(body)
    assert body["label"] == CALCULATOR_LABEL
    assert [line["key"] for line in body["lines"]] == list(LINE_ORDER)
    assert body["quantity_kg"] == 1000
    assert body["expected_accepted_kg"] == 950  # default 5% rejection
    assert body["gross_amount"] == 15000
    assert by_key["gross"]["amount"] == 15000
    assert by_key["rejection"]["amount"] == -750
    assert by_key["transport"]["amount"] == -1200
    assert by_key["transport"]["certainty"] == "confirmed"
    assert by_key["handling"]["amount"] == -250  # ₹0.25/kg loading estimate
    assert by_key["commission"]["amount"] == 0
    assert by_key["payment_wait"]["amount"] == 0
    assert by_key["platform_fee"]["amount"] == 0
    assert by_key["platform_fee"]["note"] == PLATFORM_FEE_NOTE
    assert body["net_amount"] == 12800
    assert body["net_per_kg"] == 12.8
    assert body["total_deductions"] == 2200
    assert body["payment_terms_days"] == 0
    assert body["confidence"] == "estimated"


async def test_net_proceeds_with_every_input(client: AsyncClient) -> None:
    response = await client.post(
        CALCULATOR,
        json={
            "quantity_kg": 400,
            "price_per_kg": 16,
            "distance_km": 30,
            "handling_charge_per_kg": 0.5,
            "commission_pct": 8,
            "expected_rejection_pct": 10,
            "payment_terms_days": 30,
        },
    )

    assert response.status_code == 200
    body = response.json()
    by_key = lines(body)
    transport = estimate_transport_cost(400, 30)
    accepted_value = 16 * 400 * 0.9  # 5760
    assert by_key["rejection"]["amount"] == -640
    assert by_key["transport"]["amount"] == -float(transport.cost_total)
    assert by_key["transport"]["certainty"] == "estimated"
    assert by_key["handling"]["amount"] == -200
    assert by_key["commission"]["amount"] == round(-0.08 * accepted_value, 2)
    assert by_key["payment_wait"]["amount"] == round(-accepted_value * 0.18 * 30 / 365, 2)
    expected_net = round(
        6400
        - 640
        - float(transport.cost_total)
        - 200
        + by_key["commission"]["amount"]
        + by_key["payment_wait"]["amount"],
        2,
    )
    assert body["net_amount"] == expected_net
    assert body["net_per_kg"] == round(expected_net / 400, 2)
    assert body["payment_terms_days"] == 30


async def test_calculator_validation(client: AsyncClient) -> None:
    base = {"quantity_kg": 100, "price_per_kg": 10}

    assert (await client.post(CALCULATOR, json=base | {"quantity_kg": 0})).status_code == 422
    assert (await client.post(CALCULATOR, json=base | {"price_per_kg": -1})).status_code == 422
    assert (await client.post(CALCULATOR, json=base | {"commission_pct": 120})).status_code == 422
    assert (
        await client.post(CALCULATOR, json=base | {"payment_terms_days": -1})
    ).status_code == 422
    assert (await client.post(CALCULATOR, json={"price_per_kg": 10})).status_code == 422
