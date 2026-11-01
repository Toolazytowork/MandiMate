"""Rule-based visual notes for harvest photos (no AI, no network).

``analyze(image)`` looks at colour and light only: the dominant colour of a quantised palette,
the share of clearly red and clearly green pixels, mean brightness and how even the colour is.
It turns those into two to four plain-language observations for the farmer and the buyer.

A photo cannot establish grade, weight, freshness or food safety, so every result carries
``DISCLAIMER`` and nothing here changes a harvest's grade or quality status.
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageStat

from app import schemas

DISCLAIMER = (
    "Preliminary visual notes only. A photo cannot establish grade, weight, freshness or "
    "food safety — final acceptance follows inspection."
)

ANALYSIS_SIZE = 96
"""Images are reduced to at most this many pixels per side before analysis."""
PALETTE_COLOURS = 6
"""Palette size used to find the dominant colour."""

# Hue on Pillow's 0–255 scale (255 = 360°).
RED_HUE_MAX = 18
"""≈ 25°: reds and orange-reds."""
RED_HUE_WRAP_MIN = 240
"""≈ 340°: crimson / magenta-reds."""
WARM_HUE_MAX = 45
"""≈ 63°: oranges and yellows (between red and green)."""
GREEN_HUE_MIN = 50
"""≈ 70°: yellow-greens."""
GREEN_HUE_MAX = 120
"""≈ 170°: blue-greens."""
MIN_SATURATION = 80
"""≈ 31%: below this a pixel is greyish and counts as neither red nor green."""
MIN_VALUE = 50
"""≈ 20% value: very dark pixels have no reliable hue."""
DARK_LUMA = 50
"""Luminance (0–255) under which a pixel counts as a dark patch."""

DOMINANT_SHARE = 0.6
PARTIAL_SHARE = 0.3
MIXED_GREEN_SHARE = 0.2
UNEVEN_BELOW = 0.65
DARK_PATCH_MIN = 0.05
DARK_PATCH_MAX = 0.6
DARK_PHOTO_BELOW = 0.25
OVEREXPOSED_ABOVE = 0.85
MAX_OBSERVATIONS = 4

UNIFORMITY_STD_SCALE = 128.0
"""Mean RGB standard deviation that maps to a uniformity of 0."""


@dataclass(frozen=True)
class _Measurements:
    dominant_rgb: tuple[int, int, int]
    red_ratio: float
    green_ratio: float
    warm_ratio: float
    brightness: float
    uniformity: float
    dark_ratio: float


def analyze(image: Image.Image, crop_name: str | None = None) -> schemas.PhotoAnalysis:
    """Colour statistics and plain-language observations for one harvest photo.

    ``crop_name`` only personalises wording ("consistent with ripe tomatoes"); it never changes
    a number.
    """
    measured = _measure(image)
    return schemas.PhotoAnalysis(
        dominant_color_hex="#{:02x}{:02x}{:02x}".format(*measured.dominant_rgb),
        red_ratio=round(measured.red_ratio, 3),
        green_ratio=round(measured.green_ratio, 3),
        brightness=round(measured.brightness, 3),
        uniformity=round(measured.uniformity, 3),
        observations=_observations(measured, crop_name),
        disclaimer=DISCLAIMER,
    )


def _measure(image: Image.Image) -> _Measurements:
    small = image.convert("RGB")
    small.thumbnail((ANALYSIS_SIZE, ANALYSIS_SIZE))
    pixel_count = small.width * small.height

    hsv = small.convert("HSV").get_flattened_data()
    red = green = warm = 0
    for hue, saturation, value in hsv:  # type: ignore[misc]
        if saturation < MIN_SATURATION or value < MIN_VALUE:
            continue
        if hue <= RED_HUE_MAX or hue >= RED_HUE_WRAP_MIN:
            red += 1
        elif GREEN_HUE_MIN <= hue <= GREEN_HUE_MAX:
            green += 1
        elif hue <= WARM_HUE_MAX:
            warm += 1

    luma = small.convert("L")
    brightness = ImageStat.Stat(luma).mean[0] / 255
    dark = sum(count for level, count in enumerate(luma.histogram()) if level < DARK_LUMA)

    spread = sum(ImageStat.Stat(small).stddev) / 3
    uniformity = max(0.0, 1.0 - spread / UNIFORMITY_STD_SCALE)

    return _Measurements(
        dominant_rgb=_dominant_colour(small),
        red_ratio=red / pixel_count,
        green_ratio=green / pixel_count,
        warm_ratio=warm / pixel_count,
        brightness=brightness,
        uniformity=uniformity,
        dark_ratio=dark / pixel_count,
    )


def _dominant_colour(image: Image.Image) -> tuple[int, int, int]:
    """The most frequent colour of a small median-cut palette."""
    quantised = image.quantize(colors=PALETTE_COLOURS)
    palette = quantised.getpalette() or []
    colours = quantised.getcolors() or [(1, 0)]
    _, index = max(colours, key=lambda entry: entry[0])
    red, green, blue = palette[index * 3 : index * 3 + 3] or (0, 0, 0)
    return red, green, blue


def _produce_phrase(crop_name: str | None) -> str:
    """``"Tomato"`` → ``"tomatoes"``; without a crop, ``"produce"``."""
    if not crop_name or not crop_name.strip():
        return "produce"
    name = crop_name.strip().lower()
    if name.endswith(("s", "x", "ch", "sh")):
        return name if name.endswith("s") else f"{name}es"
    if name.endswith("o"):
        return f"{name}es"
    if name.endswith("y") and len(name) > 1 and name[-2] not in "aeiou":
        return f"{name[:-1]}ies"
    return f"{name}s"


def _colour_observation(measured: _Measurements, crop_name: str | None) -> str:
    produce = _produce_phrase(crop_name)
    red, green = measured.red_ratio, measured.green_ratio
    if red >= DOMINANT_SHARE:
        return f"Predominantly deep red — consistent with ripe {produce}"
    if green >= DOMINANT_SHARE:
        return "Mostly green — for fruiting crops this suggests produce picked before full ripeness"
    if red >= PARTIAL_SHARE and green >= MIXED_GREEN_SHARE:
        return "A mix of red and green — produce appears to be at different ripeness stages"
    if red >= PARTIAL_SHARE:
        return "Partly red — some of the produce may still be ripening"
    if green >= PARTIAL_SHARE:
        return "Partly green — some of the produce may be under-ripe"
    if measured.warm_ratio >= DOMINANT_SHARE:
        return "Mostly orange or yellow tones — produce may be turning or of a yellow variety"
    return "No single dominant produce colour — the photo may show more background than produce"


def _observations(measured: _Measurements, crop_name: str | None) -> list[str]:
    notes = [_colour_observation(measured, crop_name)]
    if measured.uniformity < UNEVEN_BELOW:
        notes.append("Noticeable colour variation across the produce")
    else:
        notes.append("Colour looks fairly even across the photo")
    if DARK_PATCH_MIN <= measured.dark_ratio <= DARK_PATCH_MAX:
        notes.append("Some darker patches — check for bruising at inspection")
    if measured.brightness < DARK_PHOTO_BELOW:
        notes.append("The photo is quite dark — a daylight photo would show the produce better")
    elif measured.brightness > OVEREXPOSED_ABOVE:
        notes.append("The photo looks overexposed — details may be washed out")
    return notes[:MAX_OBSERVATIONS]
