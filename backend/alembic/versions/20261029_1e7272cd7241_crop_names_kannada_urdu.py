"""crop names in Kannada and Urdu

Adds ``crops.name_kn`` and ``crops.name_ur``. Crops of the seed catalogue get their Kannada and
Urdu names; any other crop falls back to its English name until an admin sets a translation.

``users.preferred_language`` needs no change: it is a VARCHAR(32) without a CHECK constraint, so
the new language codes "kn" and "ur" are validated by the API layer only.

Revision ID: 1e7272cd7241
Revises: dc2c12fadf9a
Create Date: 2026-10-29 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "1e7272cd7241"
down_revision: str | Sequence[str] | None = "dc2c12fadf9a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Catalogue names (kept here so the migration does not depend on application code).
CATALOGUE_NAMES: dict[str, tuple[str, str]] = {
    "TOM": ("ಟೊಮೆಟೊ", "ٹماٹر"),
    "ONI": ("ಈರುಳ್ಳಿ", "پیاز"),
    "CHI": ("ಹಸಿರು ಮೆಣಸಿನಕಾಯಿ", "ہری مرچ"),
    "POT": ("ಆಲೂಗಡ್ಡೆ", "آلو"),
    "MNG": ("ಮಾವಿನಹಣ್ಣು", "آم"),
    "GNT": ("ಕಡಲೆಕಾಯಿ", "مونگ پھلی"),
    "OKR": ("ಬೆಂಡೆಕಾಯಿ", "بھنڈی"),
    "BRN": ("ಬದನೆಕಾಯಿ", "بینگن"),
    "CAB": ("ಎಲೆಕೋಸು", "بند گوبھی"),
    "BAN": ("ಬಾಳೆಹಣ್ಣು", "کیلا"),
}


def upgrade() -> None:
    op.add_column("crops", sa.Column("name_kn", sa.String(length=64), nullable=True))
    op.add_column("crops", sa.Column("name_ur", sa.String(length=64), nullable=True))

    crops = sa.table(
        "crops",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("name_kn", sa.String),
        sa.column("name_ur", sa.String),
    )
    for code, (name_kn, name_ur) in CATALOGUE_NAMES.items():
        op.execute(
            crops.update().where(crops.c.code == code).values(name_kn=name_kn, name_ur=name_ur)
        )
    op.execute(crops.update().where(crops.c.name_kn.is_(None)).values(name_kn=crops.c.name))
    op.execute(crops.update().where(crops.c.name_ur.is_(None)).values(name_ur=crops.c.name))

    op.alter_column("crops", "name_kn", existing_type=sa.String(length=64), nullable=False)
    op.alter_column("crops", "name_ur", existing_type=sa.String(length=64), nullable=False)


def downgrade() -> None:
    op.drop_column("crops", "name_ur")
    op.drop_column("crops", "name_kn")
