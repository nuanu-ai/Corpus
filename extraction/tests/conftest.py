"""Shared pytest fixtures for extraction tests."""

import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_dir():
    """Provide a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


@pytest.fixture
def sample_csv(tmp_dir: Path) -> Path:
    """Create a minimal sample CSV file for testing."""
    p = tmp_dir / "sample.csv"
    p.write_text(
        "date,description,amount\n"
        "2025-01-15,Office supplies,-120.50\n"
        "2025-01-16,Client payment,5000.00\n"
    )
    return p


@pytest.fixture
def sample_txt(tmp_dir: Path) -> Path:
    """Create a minimal sample text file for testing."""
    p = tmp_dir / "sample.txt"
    p.write_text("Invoice #12345\nDate: 2025-01-15\nTotal: $1,200.00\n")
    return p
