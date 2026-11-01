"""PostgreSQL sequences behind the human-readable codes (see ``services/codes.py``).

They are bound to ``Base.metadata`` so ``create_all``/``drop_all`` manage them too.
"""

from __future__ import annotations

from sqlalchemy import Sequence

from app.models.base import Base

lot_code_seq = Sequence("lot_code_seq", start=1, metadata=Base.metadata)
offer_code_seq = Sequence("offer_code_seq", start=1, metadata=Base.metadata)
settlement_code_seq = Sequence("settlement_code_seq", start=1, metadata=Base.metadata)
dispute_code_seq = Sequence("dispute_code_seq", start=1, metadata=Base.metadata)

CODE_SEQUENCES: tuple[Sequence, ...] = (
    lot_code_seq,
    offer_code_seq,
    settlement_code_seq,
    dispute_code_seq,
)
