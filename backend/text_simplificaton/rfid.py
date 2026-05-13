from dataclasses import dataclass
from typing import Optional


@dataclass
class RFIDConfig:
    mock_mode: bool = True
    serial_port: Optional[str] = None
    baud_rate: int = 9600


class RFIDReader:
    """
    RFID abstraction layer.
    - mock_mode=True: use manual card input (demo/testing)
    - mock_mode=False: ready for future real hardware integration
    """

    def __init__(self, config: RFIDConfig) -> None:
        self.config = config

    def read_card_id(self, manual_input: Optional[str] = None) -> Optional[str]:
        if self.config.mock_mode:
            if not manual_input:
                return None
            return manual_input.strip().upper()

        # Placeholder for real RFID hardware implementation.
        # Add serial/USB reader logic here later.
        return None
