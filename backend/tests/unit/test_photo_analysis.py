"""Rule-based photo notes and upload decoding (no network, synthetic images only)."""

import re
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from app.core.errors import DomainError
from app.services import photo_analysis
from app.services.harvest_service import MAX_IMAGE_SIDE, decode_image, process_photo
from app.services.photo_analysis import DISCLAIMER, analyze

RED = (200, 30, 30)
GREEN = (40, 160, 50)
BRUISE = (40, 10, 10)

RIPE_TOMATOES = "Predominantly deep red — consistent with ripe tomatoes"
UNEVEN = "Noticeable colour variation across the produce"
BRUISING = "Some darker patches — check for bruising at inspection"


def solid(colour: tuple[int, int, int], size: tuple[int, int] = (200, 150)) -> Image.Image:
    return Image.new("RGB", size, colour)


def encoded(image: Image.Image, fmt: str, **params: object) -> bytes:
    buffer = BytesIO()
    image.save(buffer, fmt, **params)
    return buffer.getvalue()


def test_red_photo_reads_as_ripe_produce() -> None:
    result = analyze(solid(RED), crop_name="Tomato")

    assert result.red_ratio == 1.0
    assert result.green_ratio == 0.0
    assert result.uniformity == 1.0
    assert result.dominant_color_hex == "#c81e1e"
    assert result.observations[0] == RIPE_TOMATOES
    assert UNEVEN not in result.observations
    assert result.disclaimer == DISCLAIMER
    assert "cannot establish grade" in result.disclaimer


def test_green_photo_reads_as_unripe() -> None:
    result = analyze(solid(GREEN))

    assert result.green_ratio == 1.0
    assert result.red_ratio == 0.0
    assert result.observations[0].startswith("Mostly green")


def test_half_red_half_green_is_mixed_and_uneven() -> None:
    image = solid(RED)
    ImageDraw.Draw(image).rectangle((0, 0, 99, 149), fill=GREEN)

    result = analyze(image, crop_name="Tomato")

    assert result.red_ratio == pytest.approx(0.5, abs=0.02)
    assert result.green_ratio == pytest.approx(0.5, abs=0.02)
    assert result.uniformity < photo_analysis.UNEVEN_BELOW
    assert result.observations[0].startswith("A mix of red and green")
    assert UNEVEN in result.observations


def test_dark_patches_suggest_checking_for_bruises() -> None:
    image = solid(RED)
    draw = ImageDraw.Draw(image)
    draw.ellipse((20, 20, 70, 70), fill=BRUISE)
    draw.ellipse((120, 60, 170, 110), fill=BRUISE)

    result = analyze(image, crop_name="Tomato")

    assert result.observations[0] == RIPE_TOMATOES
    assert BRUISING in result.observations


def test_lighting_problems_are_mentioned() -> None:
    dark = analyze(solid((12, 12, 12)))
    bright = analyze(solid((250, 250, 250)))

    assert any("quite dark" in note for note in dark.observations)
    assert BRUISING not in dark.observations  # the whole photo is dark, not patches
    assert any("overexposed" in note for note in bright.observations)
    assert dark.observations[0].startswith("No single dominant produce colour")


@pytest.mark.parametrize(
    ("crop_name", "phrase"),
    [(None, "produce"), ("Tomato", "tomatoes"), ("Chilli", "chillis"), ("Berry", "berries")],
)
def test_crop_name_only_changes_the_wording(crop_name: str | None, phrase: str) -> None:
    result = analyze(solid(RED), crop_name=crop_name)

    assert result.observations[0] == f"Predominantly deep red — consistent with ripe {phrase}"
    assert result.red_ratio == 1.0


@pytest.mark.parametrize(
    "colour", [RED, GREEN, BRUISE, (230, 120, 20), (128, 128, 128), (250, 250, 250)]
)
def test_values_are_bounded_and_observations_are_two_to_four(
    colour: tuple[int, int, int],
) -> None:
    image = solid(colour)
    ImageDraw.Draw(image).rectangle((10, 10, 40, 40), fill=(0, 0, 0))

    result = analyze(image)

    assert re.fullmatch(r"#[0-9a-f]{6}", result.dominant_color_hex)
    for value in (result.red_ratio, result.green_ratio, result.brightness, result.uniformity):
        assert 0 <= value <= 1
    assert 2 <= len(result.observations) <= 4


# ─────────────────────────── Upload decoding ───────────────────────────


def test_large_photos_are_resized_and_reencoded_as_webp() -> None:
    webp, analysis = process_photo(encoded(solid(RED, (3200, 1000)), "JPEG"), "Tomato")

    with Image.open(BytesIO(webp)) as image:
        assert image.format == "WEBP"
        assert max(image.size) == MAX_IMAGE_SIDE
        assert image.size == (1600, 500)
    assert analysis.observations[0] == RIPE_TOMATOES


def test_exif_orientation_is_applied() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise when displayed
    data = encoded(solid(RED, (300, 100)), "JPEG", exif=exif)

    image = decode_image(data)

    assert image.size == (100, 300)
    assert image.mode == "RGB"


def test_transparent_png_is_flattened_on_white() -> None:
    data = encoded(Image.new("RGBA", (10, 10), (0, 0, 0, 0)), "PNG")

    image = decode_image(data)

    assert image.mode == "RGB"
    assert image.getpixel((5, 5)) == (255, 255, 255)


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"definitely not an image",
        encoded(solid(RED), "GIF"),
        encoded(solid(RED), "BMP"),
        encoded(solid(RED), "PNG")[:40],
    ],
)
def test_non_photos_are_refused(data: bytes) -> None:
    with pytest.raises(DomainError) as error:
        decode_image(data)

    assert error.value.status_code == 415
