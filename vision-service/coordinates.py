"""Coordinate conversions matching src/lib/homography.js exactly.

Shared test vector:
e4, a1, h1, a8, h8 with flip=False and flip=True.
"""

def square_to_cell(square: str, flipped: bool = False) -> int:
    """Map a board square (e.g. 'e4') to the corresponding top-down cell index (0..63).
    
    col 0 = file a, col 7 = file h.
    row 0 = rank 8, row 7 = rank 1 (when flip is False).
    """
    if len(square) < 2:
        raise ValueError(f"Invalid square: {square}")
    file = ord(square[0].lower()) - 97  # a=0 ... h=7
    rank = int(square[1]) - 1           # 1..8 -> 0..7
    col = (7 - file) if flipped else file
    row = rank if flipped else (7 - rank)
    return row * 8 + col

def cell_to_square(cell_index: int, flipped: bool = False) -> str:
    """Map a top-down cell index (0..63) to a board square string."""
    if not (0 <= cell_index <= 63):
        raise ValueError(f"Cell index out of range: {cell_index}")
    row = cell_index // 8
    col = cell_index % 8
    file = (7 - col) if flipped else col
    rank = (row + 1) if flipped else (8 - row)
    return f"{chr(97 + file)}{rank}"

# Canonical test vector required by protocol
SHARED_TEST_VECTORS = [
    # (square, flip, expected_cell, expected_row, expected_col)
    ("a8", False, 0, 0, 0),
    ("h8", False, 7, 0, 7),
    ("a1", False, 56, 7, 0),
    ("h1", False, 63, 7, 7),
    ("e4", False, 36, 4, 4),
    ("a8", True, 63, 7, 7),
    ("h8", True, 56, 7, 0),
    ("a1", True, 7, 0, 7),
    ("h1", True, 0, 0, 0),
    ("e4", True, 27, 3, 3),
]
