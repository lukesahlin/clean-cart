# adapters/__init__.py
# Shared data class and registry for store availability adapters.
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class AvailabilityResult:
    product_name: str        # what we searched for
    in_stock: bool
    price: Optional[float]
    store_name: str
    store_branch_id: str     # place_id from Google Places
    chain_id: str            # e.g. "walmart"
    last_checked: datetime = field(default_factory=datetime.utcnow)
    source_url: str = ""

    def to_dict(self):
        return {
            "product_name": self.product_name,
            "in_stock": self.in_stock,
            "price": self.price,
            "store_name": self.store_name,
            "store_branch_id": self.store_branch_id,
            "chain_id": self.chain_id,
            "last_checked": self.last_checked.isoformat(),
            "source_url": self.source_url,
        }
